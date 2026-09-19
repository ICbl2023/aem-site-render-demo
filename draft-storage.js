// Brouillons partagés : réponses ET pièces conservées côté serveur, pour que le candidat reprenne son dossier
// depuis un autre appareil, ou qu'un proche le termine avec lui, sans rien re-photographier.
// Un brouillon n'est pas un envoi : il reste invisible de l'espace admin et s'efface à l'expiration.
import {mkdir,readdir,readFile,writeFile,rename,rm} from "node:fs/promises";
import path from "node:path";
import {randomBytes,createHash,timingSafeEqual,randomUUID} from "node:crypto";
import {DRAFT_TTL} from "./drafts.js";
import {UUID_RE} from "./storage.js";
import {createLegacyFsBlobStore,createFileBlobs} from "./blob-store.js";

// Le jeton « <draftId>.<secret> » tient dans le fragment d'une URL : 32 octets en base64url font 43 caractères.
const SECRET_RE=/^[A-Za-z0-9_-]{43}$/;
export const DRAFT_ANSWER_BYTES=256*1024;
const KEY_RE=/^[a-z0-9_]{1,64}$/i;
export const draftTooLarge=message=>Object.assign(new Error(message),{code:"DRAFT_TOO_LARGE",status:413});
export const draftConflict=()=>Object.assign(new Error("Ce brouillon a été modifié ailleurs (autre appareil, autre onglet). Rechargez cette page pour reprendre la dernière version."),{code:"DRAFT_CONFLICT",status:409});
const notFound=()=>Object.assign(new Error("Ce brouillon n’existe plus : il a expiré ou il a déjà été envoyé."),{code:"DRAFT_GONE",status:404});

export function parseDraftToken(value){
 const parts=String(value||"").split(".");
 const [draftId="",secret=""]=parts;
 if(parts.length!==2 || !UUID_RE.test(draftId) || !SECRET_RE.test(secret))return null;
 return {draftId,secret};
}
const fingerprint=secret=>createHash("sha256").update(String(secret)).digest("hex");
// Comparaison en temps constant : un jeton valide et un jeton faux coûtent le même temps.
function sameSecret(expected,secret){
 const a=Buffer.from(fingerprint(secret),"hex"),b=Buffer.from(String(expected||""),"hex");
 return a.length===b.length && timingSafeEqual(a,b);
}
// Nom de stockage : jamais celui fourni par le navigateur, et préfixé par l'index pour rester unique.
function sanitizeName(name){
 return String(name||"fichier").replace(/[^\w.\-()+ ]/g,"_").slice(0,120)||"fichier";
}
// Vue destinée au navigateur : ce qu'il faut pour savoir quelles pièces existent et les télécharger.
// sha256 est l'empreinte du contenu réellement stocké : deux photos prises à la suite portent souvent le même
// nom et la même taille, seule l'empreinte dit à l'autre appareil que les octets ont changé. Elle n'est
// communiquée qu'au porteur du jeton, comme le reste du brouillon.
const fileView=entry=>({index:entry.index,key:entry.key,name:entry.name,size:entry.size,contentType:entry.contentType,sha256:entry.sha256||""});
// clientDraftId : identifiant que le navigateur donne au brouillon, distinct de l'identifiant de stockage
// porté par le jeton. C'est lui qui permet à un appareil de reconnaître que les fichiers qu'il détient
// appartiennent bien à ce brouillon.
function publicView(meta){
 return {
  draftId:meta.draftId,clientDraftId:meta.clientDraftId||"",workflow:meta.workflow,answers:meta.answers,step:meta.step,
  submissionId:meta.submissionId,editMode:Boolean(meta.editMode),files:(meta.files||[]).map(fileView),
  revision:meta.revision,savedAt:meta.savedAt,expiresAt:meta.expiresAt
 };
}

export function createDraftStorage(dataDir,{now=()=>Date.now(),files,blobs,blobScope="brouillons"}={}){
 const root=path.resolve(dataDir);
 const fileStore=files || (blobs?createFileBlobs(blobs,{scope:blobScope}):createLegacyFsBlobStore(root));
 // Écritures sérialisées par brouillon : le téléphone et l'ordinateur peuvent sauvegarder en même temps.
 const locks=new Map();
 function withLock(key,fn){
  const run=(locks.get(key)||Promise.resolve()).then(fn);
  const tail=run.catch(()=>{});
  locks.set(key,tail);
  tail.then(()=>{if(locks.get(key)===tail)locks.delete(key);});
  return run;
 }
 const dirOf=draftId=>path.join(root,draftId);
 async function eraseDraft(draftId){
  await fileStore.removeAll(draftId).catch(()=>{});
  await rm(dirOf(draftId),{recursive:true,force:true});
 }
 async function writeMeta(meta){
  const target=path.join(dirOf(meta.draftId),"meta.json");
  await mkdir(dirOf(meta.draftId),{recursive:true,mode:0o700});
  await writeFile(target+".tmp",JSON.stringify(meta),{mode:0o600});
  await rename(target+".tmp",target);
  return meta;
 }
 // Brouillon absent, illisible ou expiré : null. Un meta.json corrompu est journalisé sans son contenu.
 async function readMeta(draftId){
  let meta;
  try{
   meta=JSON.parse(await readFile(path.join(dirOf(draftId),"meta.json"),"utf8"));
   if(!meta || typeof meta!=="object" || Array.isArray(meta))throw new SyntaxError("structure inattendue");
  }catch(e){
   if(e.code==="ENOENT" || e.code==="ENOTDIR")return null;
   if(e instanceof SyntaxError){console.error("[brouillon] meta.json illisible pour "+draftId);return null;}
   throw e;
  }
  if(!Number.isFinite(meta.expiresAt) || meta.expiresAt<=now()){await eraseDraft(draftId);return null;}
  return meta;
 }
 async function authorized(token){
  const parsed=parseDraftToken(token);
  if(!parsed)return null;
  const meta=await readMeta(parsed.draftId);
  // Jeton syntaxiquement valide mais brouillon inconnu : on consomme quand même un hachage pour ne pas
  // révéler par le temps de réponse si l'identifiant existe.
  if(!meta){sameSecret(fingerprint("inconnu"),parsed.secret);return null;}
  return sameSecret(meta.secretHash,parsed.secret)?meta:null;
 }
 return {
  root,
  // Création : le secret n'est renvoyé qu'ici, une seule fois. Le disque n'en garde que l'empreinte.
  async create(workflow){
   await mkdir(root,{recursive:true,mode:0o700});
   const draftId=randomUUID(),secret=randomBytes(32).toString("base64url"),savedAt=now();
   const meta=await writeMeta({
    version:1,draftId,workflow,secretHash:fingerprint(secret),
    answers:{workflow},step:"welcome",submissionId:"",clientDraftId:"",editMode:false,files:[],
    revision:0,createdAt:savedAt,savedAt,expiresAt:savedAt+DRAFT_TTL
   });
   return {token:draftId+"."+secret,draft:publicView(meta)};
  },
  async read(token){
   const meta=await authorized(token);
   return meta?publicView(meta):null;
  },
  // Conflit optimiste : la révision attendue doit être celle du disque, sinon l'autre appareil serait écrasé.
  save(token,patch,revision){
   const parsed=parseDraftToken(token);
   if(!parsed)return Promise.reject(notFound());
   return withLock(parsed.draftId,async()=>{
    const meta=await authorized(token);
    if(!meta)throw notFound();
    if(meta.revision!==revision)throw draftConflict();
    const savedAt=now();
    Object.assign(meta,{
     answers:{...patch.answers,workflow:meta.workflow},
     step:typeof patch.step==="string"?patch.step.slice(0,64):meta.step,
     submissionId:UUID_RE.test(patch.submissionId||"")?patch.submissionId:meta.submissionId,
     clientDraftId:UUID_RE.test(patch.clientDraftId||"")?patch.clientDraftId:meta.clientDraftId||"",
     editMode:Boolean(patch.editMode),
     revision:meta.revision+1,savedAt,expiresAt:savedAt+DRAFT_TTL
    });
    await writeMeta(meta);
    return publicView(meta);
   });
  },
  // Pièces : ajout, lecture et retrait passent par le verrou du brouillon, comme les réponses. La liste des
  // fichiers appartient au serveur seul — une sauvegarde de réponses ne peut donc pas la contredire.
  // Volontairement sans contrôle de révision : téléverser une photo pendant que l'autre appareil répond
  // à une question ne doit pas échouer, les deux opérations ne portent pas sur la même chose.
  addFiles(token,key,uploads,limits){
   const parsed=parseDraftToken(token);
   if(!parsed)return Promise.reject(notFound());
   return withLock(parsed.draftId,async()=>{
    const meta=await authorized(token);
    if(!meta)throw notFound();
    if(!KEY_RE.test(String(key||"")))throw Object.assign(new Error("Pièce inconnue."),{status:400});
    meta.files||=[];
    const total=meta.files.reduce((sum,f)=>sum+f.size,0)+uploads.reduce((sum,f)=>sum+f.size,0);
    if(meta.files.length+uploads.length>limits.fileCount)throw draftTooLarge("Trop de documents dans ce dossier ("+limits.fileCount+" au maximum).");
    if(total>limits.totalBytes)throw draftTooLarge("L’ensemble des documents dépasse la taille autorisée.");
    let index=meta.files.reduce((max,f)=>Math.max(max,f.index),-1)+1;
    const added=[];
    for(const upload of uploads){
     const storedAs=index+"-"+sanitizeName(upload.name);
     await fileStore.putFile(parsed.draftId,storedAs,upload.content,upload.contentType);
     // Empreinte calculée ici, sur les octets écrits : jamais celle annoncée par le navigateur.
     const sha256=createHash("sha256").update(upload.content).digest("hex");
     const entry={index,key,name:upload.name,size:upload.size,contentType:upload.contentType,sha256,storedAs,addedAt:new Date().toISOString()};
     meta.files.push(entry);added.push(entry);index++;
    }
    const savedAt=now();
    Object.assign(meta,{savedAt,expiresAt:savedAt+DRAFT_TTL});
    await writeMeta(meta);
    return {files:meta.files.map(fileView),added:added.map(fileView),expiresAt:meta.expiresAt};
   });
  },
  async readFileContent(token,index){
   const meta=await authorized(token);
   if(!meta)return null;
   const entry=(meta.files||[]).find(f=>f.index===Number(index));
   if(!entry)return null;
   const content=await fileStore.getFile(meta.draftId,entry.storedAs);
   if(!content)return null;
   return {entry:fileView(entry),content};
  },
  removeFile(token,index){
   const parsed=parseDraftToken(token);
   if(!parsed)return Promise.reject(notFound());
   return withLock(parsed.draftId,async()=>{
    const meta=await authorized(token);
    if(!meta)throw notFound();
    const entry=(meta.files||[]).find(f=>f.index===Number(index));
    if(!entry)return {files:(meta.files||[]).map(fileView)};
    meta.files=meta.files.filter(f=>f!==entry);
    await fileStore.removeFile(parsed.draftId,entry.storedAs).catch(()=>{});
    const savedAt=now();
    Object.assign(meta,{savedAt,expiresAt:savedAt+DRAFT_TTL});
    await writeMeta(meta);
    return {files:meta.files.map(fileView),expiresAt:meta.expiresAt};
   });
  },
  remove(token){
   const parsed=parseDraftToken(token);
   if(!parsed)return Promise.resolve(false);
   return withLock(parsed.draftId,async()=>{
    const meta=await authorized(token);
    if(!meta)return false;
    await eraseDraft(parsed.draftId);
    return true;
   });
  },
  // Expiration glissante : readMeta efface au passage, cette purge traite les brouillons jamais rouverts.
  async purgeExpired(){
   let removed=0;
   for(const draftId of await readdir(root).catch(()=>[])){
    if(!UUID_RE.test(draftId))continue;
    if(!await readMeta(draftId).catch(()=>null))removed++;
   }
   return removed;
  },
  fileStore
 };
}
