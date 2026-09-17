// Brouillon partagé : réponses et pièces conservées côté serveur, pour reprendre le dossier depuis n'importe
// quel appareil avec le lien de reprise. Même interface que createDraftStore (key, load, save, remove),
// pour que draft-ui.js et app.js ne connaissent pas la différence.
//
// Répartition des rôles :
// - serveur   : source de vérité. Réponses, étape et documents. Seul à porter la `revision`, donc seul arbitre
//               quand deux appareils enregistrent en même temps.
// - IndexedDB : cache local des documents (évite de les retélécharger) et filet complet quand le réseau est coupé.
import {createDraftStore,DRAFT_DAYS} from "./drafts.js";

export {DRAFT_DAYS};
const TOKEN_PREFIX="aem-draft-token:";
const conflict=message=>Object.assign(new Error(message||"Ce brouillon a été modifié dans un autre onglet. Recharge cette page pour reprendre la dernière version."),{code:"DRAFT_CONFLICT"});
// Nom et taille ne suffisent pas à reconnaître une pièce : un iPhone rend toutes ses photos sous « image.jpeg »
// et deux clichés de la même scène pèsent souvent le même nombre d'octets. La destination, le nom et la taille
// ne servent donc qu'à rapprocher des candidats ; c'est l'empreinte du contenu qui tranche.
const signature=(key,name,size)=>key+"\u0000"+name+"\u0000"+size;
// Empreintes SHA-256 calculées une seule fois par objet File (Web Crypto, disponible sur Safari iOS en https).
const digests=new WeakMap();
const hex=buffer=>[...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
// Chaîne vide = empreinte indisponible (page servie hors contexte sécurisé, fichier illisible). L'appel reste
// silencieux : la comparaison retombe alors sur nom + taille, comme avant, plutôt que d'empêcher la reprise.
function fingerprint(file){
 if(digests.has(file))return digests.get(file);
 const engine=globalThis.crypto?.subtle;
 if(!engine)return Promise.resolve("");
 const computing=file.arrayBuffer().then(buffer=>engine.digest("SHA-256",buffer)).then(hex).catch(()=>"");
 digests.set(file,computing);
 return computing;
}
// Une pièce du serveur et un fichier local sont le même document si le contenu est le même. Sans empreinte
// serveur (brouillon créé avant cette version) ou sans Web Crypto, nom + taille restent le seul critère.
async function sameContent(entry,file){
 if(entry.name!==file.name || entry.size!==file.size)return false;
 if(!entry.sha256)return true;
 const local=await fingerprint(file);
 return local?local===entry.sha256:true;
}

// Le jeton arrive dans le fragment (#r=…) et non dans la query : il n'est ainsi ni journalisé par le serveur,
// ni transmis dans l'en-tête Referer. Il est retiré après vérification et mémorisation du lien.
// sessionStorage garde une copie immédiate : un clic sur une ancre (#question-card) avant le module
// ne doit pas faire perdre le lien de reprise (surtout Safari / ouverture depuis Mail).
const PENDING_HASH="aem-draft-hash";
function tokenFromUrl(){
 const match=/[#&]r=([A-Za-z0-9._-]+)/.exec(location.hash||"");
 if(match?.[1]){
  try{sessionStorage.setItem(PENDING_HASH,match[1]);}catch{/* navigation privée */}
  return match[1];
 }
 try{return sessionStorage.getItem(PENDING_HASH)||"";}catch{return "";}
}
function clearUrlToken(){
 const rest=(location.hash||"").replace(/[#&]r=[A-Za-z0-9._-]+/,"").replace(/^&/,"#");
 try{history.replaceState(null,"",location.pathname+location.search+(rest.length>1?rest:""));}catch{/* barre d'adresse inchangée : sans conséquence */}
 try{sessionStorage.removeItem(PENDING_HASH);}catch{/* */}
}

export function createRemoteDraftStore(workflow,{scope=new URL(".",location.href).pathname,fetcher=globalThis.fetch?.bind(globalThis),local=createDraftStore(workflow,{scope}),notify=()=>{}}={}){
 const key=scope+":"+workflow;
 const tokenKey=TOKEN_PREFIX+key;
 const readToken=()=>{try{return localStorage.getItem(tokenKey)||"";}catch{return "";}};
 const writeToken=value=>{try{value?localStorage.setItem(tokenKey,value):localStorage.removeItem(tokenKey);}catch{/* navigation privée : la reprise passera par le lien reçu par mail */}};
 // Un jeton dans l'URL est toujours prioritaire : c'est le geste explicite du candidat (ou du parent) qui ouvre le lien.
 const fromUrl=tokenFromUrl();
 const previousToken=readToken(),differentLink=Boolean(fromUrl && fromUrl!==previousToken);
 let token=fromUrl||previousToken,unverifiedLink=differentLink;
 const unverified=()=>Object.assign(new Error("Ce lien n’a pas pu être vérifié. Recharge cette page avec une connexion avant de continuer ce dossier."),{code:"DRAFT_UNVERIFIED"});
 let revision=0,localRevision=0,serverDown=false,offline=false,openedFromLink=Boolean(fromUrl);
 // Pièces connues du serveur, pour savoir lesquelles téléverser et lesquelles retirer.
 let serverFiles=[];

 async function call(method,{path="api/draft",body,form,expect=[200],raw=false}={}){
  if(!fetcher)throw new Error("réseau indisponible");
  const response=await fetcher("./"+path,{
   method,
   headers:{"X-AEM-Request":"questionnaire",...(token?{"X-AEM-Draft":token}:{}),...(body?{"Content-Type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:form?{body:form}:{})
  });
  if(raw)return response.ok?response:null;
  const result=await response.json().catch(()=>null);
  if(response.status===409)throw conflict(result?.error);
  // 503 : reprise multi-appareils non configurée sur cet hébergement. On retombe sur le brouillon local sans le dire deux fois.
  if(response.status===503){if(path==="api/draft")serverDown=true;throw new Error(result?.error||"service indisponible");}
  if(response.status===404){writeToken("");token="";revision=0;return null;}
  if(!expect.includes(response.status))throw Object.assign(new Error(result?.error||"Le serveur a refusé la sauvegarde du brouillon."),{status:response.status,code:response.status===413?"DRAFT_TOO_LARGE":""});
  return result;
 }
 // Reconstitue les pièces du brouillon : le cache local d'abord, le téléchargement ensuite.
 // Sur l'appareil d'origine rien n'est retéléchargé ; sur celui d'un proche, tout arrive du serveur.
 async function materialize(draft,localFiles){
  const cache=new Map();
  for(const [fileKey,list] of localFiles||new Map())for(const file of list){
   const sig=signature(fileKey,file.name,file.size);
   if(!cache.has(sig))cache.set(sig,[]);
   cache.get(sig).push(file);
  }
  // Un fichier du cache n'est retenu que si son contenu est bien celui annoncé par le serveur : sans cette
  // vérification, une photo remplacée depuis l'autre appareil réapparaîtrait ici dans son ancienne version.
  const fromCache=async entry=>{
   const list=cache.get(signature(entry.key,entry.name,entry.size));
   if(!list?.length)return null;
   for(let i=0;i<list.length;i++)if(await sameContent(entry,list[i]))return list.splice(i,1)[0];
   return null;
  };
  const entries=[];
  for(const entry of draft.files||[])entries.push({entry,cached:await fromCache(entry)});
  const files=new Map(),missing=[];
  let downloads=0;
  const pending=entries.filter(item=>!item.cached).length;
  if(pending)notify("Récupération de "+pending+" document(s) déjà transmis…","saving");
  for(const {entry,cached} of entries){
   let file=cached;
   if(!file){
    try{
     const response=await call("GET",{path:"api/draft/files/"+entry.index,raw:true});
     if(response){
      const blob=await response.blob();
      file=new File([blob],entry.name,{type:entry.contentType||blob.type});
      // Ces octets viennent du serveur : leur empreinte est connue, inutile de la recalculer au prochain envoi.
      if(entry.sha256)digests.set(file,Promise.resolve(entry.sha256));
      downloads++;
     }
    }catch{/* signalé comme à réajouter, jamais effacé du serveur */}
   }
   if(file){
    if(!files.has(entry.key))files.set(entry.key,[]);
    files.get(entry.key).push(file);
   }else missing.push({key:entry.key,name:entry.name,size:entry.size,type:entry.contentType});
  }
  return {files,missing,downloads};
 }
 function merge(draft,localLoaded,materialized){
  return {
   record:{
    version:1,workflow:draft.workflow,draftId:draft.clientDraftId,submissionId:draft.submissionId,
    answers:draft.answers,step:draft.step,editMode:Boolean(draft.editMode),
    revision:draft.revision,savedAt:draft.savedAt,expiresAt:draft.expiresAt
   },
   files:materialized.files,missing:materialized.missing,shared:true,downloads:materialized.downloads
  };
 }
 // "created" quand un brouillon local, commencé hors ligne ou avant l'activation du partage, vient d'être publié :
 // sa révision locale n'a rien à voir avec celle du serveur, qui repart de zéro.
 async function ensureDraft(){
  if(token)return "existing";
  const created=await call("POST",{body:{workflow},expect:[201]});
  if(!created?.token)return "";
  token=created.token;writeToken(token);revision=created.draft.revision;serverFiles=[];
  return "created";
 }
 // Le local suit sa propre révision. Un conflit ici signifie qu'un autre onglet a écrit une version plus récente :
 // il est propagé sans réécrire, sinon cet onglet écraserait des réponses plus récentes que les siennes.
 // Après un conflit, garder la révision lue : seul un rechargement autorise à reprendre la version récente.
 async function saveLocal(snapshot,pending=true){
  const result=await local.save({...snapshot,remote:{draftId:token.split(".")[0]||"",revision,pending}},localRevision);
  localRevision=result.revision;
  return result;
 }
 // Aligne les pièces du serveur sur celles du questionnaire : téléverse les nouvelles, retire celles que le
 // candidat a enlevées. Une pièce absente localement mais toujours annoncée comme « à réajouter » est conservée :
 // seule une suppression explicite la retire du serveur.
 async function syncFiles(snapshot){
  const wanted=[];
  for(const [fileKey,list] of snapshot.files)for(const file of list)wanted.push({key:fileKey,file});
  const remaining=[...serverFiles];
  const toUpload=new Map();
  // Une pièce déjà présente n'est pas renvoyée ; une pièce remplacée par un autre contenu l'est, et l'ancienne
  // version reste dans `remaining`, donc part à la suppression juste après.
  for(const {key:fileKey,file} of wanted){
   let index=-1;
   for(let i=0;i<remaining.length;i++)if(remaining[i].key===fileKey && await sameContent(remaining[i],file)){index=i;break;}
   if(index>=0){remaining.splice(index,1);continue;}
   if(!toUpload.has(fileKey))toUpload.set(fileKey,[]);
   toUpload.get(fileKey).push(file);
  }
  const keep=new Set((snapshot.missing||[]).map(item=>signature(item.key,item.name,item.size)));
  const toDelete=remaining.filter(entry=>!keep.has(signature(entry.key,entry.name,entry.size)));
  let uploaded=0,pending=0,tooLarge="";
  for(const entry of toDelete){
   try{
    const result=await call("DELETE",{path:"api/draft/files/"+entry.index});
    if(result)serverFiles=result.files;
   }catch{pending++;}
  }
  for(const [fileKey,list] of toUpload){
   const total=list.length;
   notify("Envoi de "+total+" document(s) pour la reprise sur vos autres appareils…","saving");
   const form=new FormData();
   form.append("key",fileKey);
   list.forEach((file,index)=>form.append("file_"+index,file,file.name));
   try{
    const result=await call("POST",{path:"api/draft/files",form});
    if(result){serverFiles=result.files;uploaded+=total;}
   }catch(error){
    if(error.code==="DRAFT_TOO_LARGE")tooLarge=error.message;
    pending+=total;
   }
  }
  return {uploaded,pending,tooLarge};
 }
 return {
  key,
  get shared(){return Boolean(token) && !serverDown && !unverifiedLink;},
  get offline(){return offline;},
  get openedFromLink(){return openedFromLink;},
  tokenHeader(){return token?{"X-AEM-Draft":token}:{};},
  resumeUrl(){return token?location.origin+location.pathname+"#r="+token:"";},
  async sendLink(email){
   if(!token)throw new Error("Commence à répondre : le lien de reprise sera disponible dès la première réponse enregistrée.");
   await call("POST",{path:"api/draft/link",body:{email}});
  },
  async load(){
   const localLoaded=await local.load().catch(error=>({error}));
   localRevision=localLoaded?.record?.revision||0;
   if(!token){
    if(localLoaded?.error)throw localLoaded.error;
    // Brouillon commencé avant l'activation du partage, ou navigateur sans jeton : il sera publié à la première sauvegarde.
    return localLoaded;
   }
   try{
    const result=await call("GET");
    if(!result){
     // Le brouillon serveur a disparu (expiré ou dossier envoyé) : le brouillon local ne doit pas le ressusciter.
     if(!differentLink)await local.remove(localLoaded?.record?.draftId).catch(()=>{});
     localRevision=0;serverFiles=[];
     if(differentLink)throw Object.assign(new Error("Ce lien est invalide, expiré ou correspond à un dossier déjà envoyé. Aucun ancien brouillon n’a été ouvert."),{code:"DRAFT_UNVERIFIED"});
     return {record:null,expired:true};
    }
    revision=result.draft.revision;
    serverFiles=result.draft.files||[];
    // Brouillon réservé mais jamais enregistré (le candidat a ouvert la page sans rien saisir) : rien à reprendre.
    if(!result.draft.revision && !serverFiles.length){
     if(differentLink && localLoaded?.record){await local.remove(localLoaded.record.draftId);localRevision=0;}
     unverifiedLink=false;writeToken(token);if(fromUrl)clearUrlToken();
     return differentLink || localLoaded?.error?{record:null}:localLoaded;
    }
    const sameDraft=Boolean(result.draft.clientDraftId) && localLoaded?.record?.draftId===result.draft.clientDraftId;
    const cached=localLoaded?.record?.remote;
    const pending=Boolean(sameDraft && cached?.pending && cached.draftId===token.split(".")[0]);
    // Une saisie locale non envoyée prime seulement si le serveur n'a pas changé depuis sa dernière lecture.
    if(pending && cached.revision===revision){
     unverifiedLink=false;writeToken(token);if(fromUrl)clearUrlToken();
     return {...localLoaded,record:{...localLoaded.record,revision},pending:true};
    }
    const materialized=await materialize(result.draft,sameDraft && !localLoaded?.error?localLoaded.files:new Map());
    // Cet appareil détient un autre dossier sous la même clé locale : ouvrir un lien de reprise est un geste
    // explicite, le dossier du lien prend la place. Sans cela, chaque sauvegarde locale entrerait en conflit.
    if(localLoaded?.record && !sameDraft){
     await local.remove(localLoaded.record.draftId);
     localRevision=0;
    }
    unverifiedLink=false;writeToken(token);if(fromUrl)clearUrlToken();
    return {...merge(result.draft,localLoaded,materialized),conflict:pending};
   }catch(error){
    if(error.code==="DRAFT_CONFLICT" || error.code==="DRAFT_UNVERIFIED")throw error;
    offline=true;
    if(unverifiedLink)throw unverified();
    if(localLoaded?.error)throw localLoaded.error;
    // La révision IndexedDB ne sert jamais de révision serveur, y compris après fermeture de la page.
    revision=localLoaded?.record?.remote?.revision||0;
    return {...localLoaded,record:localLoaded?.record?{...localLoaded.record,revision}:null,degraded:true};
   }
  },
  async save(snapshot,expected=0){
   if(unverifiedLink)throw unverified();
   // Le local est écrit d'abord : même si le réseau tombe juste après, les réponses et les fichiers sont conservés ici.
   const localResult=await saveLocal(snapshot);
   if(serverDown)return {...localResult,offline:true,revision};
   try{
    const state=await ensureDraft();
    if(!state)return {...localResult,offline:true,revision};
    if(state==="created")await saveLocal(snapshot);
    const payload={
     answers:snapshot.answers,step:snapshot.step,submissionId:snapshot.submissionId,clientDraftId:snapshot.draftId,editMode:Boolean(snapshot.editMode),
     revision:state==="created"?revision:(expected||revision)
    };
    const result=await call("PUT",{body:payload});
    if(!result)throw Object.assign(new Error("Ce brouillon n’existe plus : il a expiré ou il a déjà été envoyé."),{code:"DRAFT_GONE"});
    revision=result.draft.revision;offline=false;
    // Les pièces sont synchronisées après les réponses : une photo qui n'est pas encore montée ne doit pas
    // empêcher d'enregistrer la saisie en cours.
    const files=await syncFiles(snapshot);
    await saveLocal(snapshot,files.pending>0);
    return {
     revision:result.draft.revision,savedAt:result.draft.savedAt,expiresAt:result.draft.expiresAt,
     missingCount:localResult.missingCount,shared:true,
     uploaded:files.uploaded,filesPending:files.pending,tooLarge:files.tooLarge
    };
   }catch(error){
    if(error.code==="DRAFT_CONFLICT" || error.code==="DRAFT_GONE")throw error;
    offline=true;
    // La révision renvoyée reste celle du serveur : sinon la reprise en ligne enverrait un 409 contre soi-même.
    return {...localResult,offline:true,revision};
   }
  },
  // Le serveur d'abord : c'est lui qui rend le lien de reprise inopérant, y compris pour un proche qui l'aurait reçu.
  // L'échec de l'effacement local est ensuite propagé : des pièces d'identité ne doivent pas rester sur l'appareil
  // sans que le candidat en soit averti et puisse réessayer.
  async remove(draftId){
   if(token && !serverDown){
    try{await call("DELETE");}catch(error){if(error.code==="DRAFT_CONFLICT" || error.code==="DRAFT_UNVERIFIED")throw error;/* la purge serveur s'en chargera à l'expiration */}
   }
   writeToken("");token="";revision=0;openedFromLink=false;unverifiedLink=false;serverFiles=[];
   try{
    await local.remove(draftId);
    localRevision=0;
   }catch(error){
    if(error.code==="DRAFT_CONFLICT")localRevision=(await local.load().catch(()=>null))?.record?.revision||0;
    throw error;
   }
  }
 };
}
