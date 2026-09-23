import {mkdir,readdir,readFile,writeFile,rename,rm} from "node:fs/promises";
import path from "node:path";
import {ageFromDate,workflows,documentsFor} from "./logic.js";
import {createLegacyFsBlobStore,createFileBlobs} from "./blob-store.js";
import {exportFileName,fileExtension,normalizeFace,needsFaceQualification} from "./export-names.js";

export const UUID_RE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function isSubmissionId(id){return typeof id==="string" && UUID_RE.test(id);}

export const dossierStatuses = {
 received:"Reçu",
 in_progress:"En cours",
 missing_pieces:"Pièces manquantes",
 ready:"Prêt",
 archived:"Classé"
};

export const historyActions = {received:"Réception",status:"Statut",note:"Note interne",request:"Demande de pièce",candidate_mail:"Mail candidat",email_sent:"Mail libre",admin_notify:"Notification admin",retention_warning:"Alerte conservation",assign:"Suivi",upload:"Pièce ajoutée au comptoir",delete:"Suppression"};
export const adminNotifyStates = {pending:"À envoyer",sending:"Envoi en cours",sent:"Envoyée",failed:"Échec",uncertain:"Résultat incertain",skipped:"Non envoyée"};
export const DAY_MS=86400000;
const STALE_AFTER_DAYS=10;
// Jours écoulés depuis la dernière relance quand le dossier attend toujours des pièces ; null sinon.
export function staleDaysOf(meta,now=Date.now()){
 if(meta.status!=="missing_pieces")return null;
 const last=[...(meta.history||[])].reverse().find(e=>e.action==="request");
 if(!last)return null;
 return Math.floor((now-new Date(last.at).getTime())/86400000);
}
export {STALE_AFTER_DAYS};
export function historyEntry(by,action,details){
 return {at:new Date().toISOString(),by:String(by||"système").slice(0,64),action:Object.hasOwn(historyActions,action)?action:"note",details:String(details||"").slice(0,2500)};
}
function sanitizeName(name){
 return String(name||"fichier").replace(/[^\w.\-()+ ]/g,"_").slice(0,120)||"fichier";
}
function fileExt(name){
 const m=String(name||"").match(/\.([A-Za-z0-9]{1,8})$/);
 return m?m[1].toLowerCase():"bin";
}
function sanitizeDisplayBase(value){
 return String(value||"").replace(/[\\/:*?"<>|\u0000-\u001f]/g," ").replace(/\s+/g," ").trim().slice(0,160)||"document";
}
// Nom métier admin : « NOM Prénom - Type.ext ». Clé technique (storedAs/index) inchangée.
export function buildDisplayName({birthName,firstName,label,ext,taken=new Set()}){
 const nom=sanitizeDisplayBase(String(birthName||"").toUpperCase())||"CANDIDAT";
 const prenomRaw=String(firstName||"").trim();
 const prenom=sanitizeDisplayBase(prenomRaw?prenomRaw.charAt(0).toUpperCase()+prenomRaw.slice(1):"")||"Prenom";
 const type=sanitizeDisplayBase(label)||"Document";
 const extension=String(ext||"bin").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"bin";
 let base=nom+" "+prenom+" - "+type;
 let n=1,candidate=base+"."+extension;
 while(taken.has(candidate.toLowerCase())){n++;candidate=base+" ("+n+")."+extension;}
 taken.add(candidate.toLowerCase());
 return candidate;
}
export function fileDownloadName(file,meta=null){
 if(meta && file){
  try{
   return exportFileName({
    birthName:meta.birthName,
    firstName:meta.firstName,
    key:file.key,
    face:file.face,
    ext:fileExtension(file.originalName||file.name||file.displayName||""),
    europeSituation:meta.answers?.europeSituation||""
   });
  }catch{/* repli displayName */}
 }
 return (file&&(file.displayName||file.name))||"piece";
}
export function finalizedAtOf(meta){
 const raw=meta?.finalizedAt||meta?.createdAt;
 const n=raw?new Date(raw).getTime():NaN;
 return Number.isFinite(n)?n:null;
}
async function writeJson(target,value){
 await writeFile(target+".tmp",JSON.stringify(value,null,2),{mode:0o600});
 await rename(target+".tmp",target);
}
function summary(meta){
 return {
  id:meta.id,
  createdAt:meta.createdAt,
  finalizedAt:meta.finalizedAt||meta.createdAt||"",
  updatedAt:meta.updatedAt,
  status:meta.status,
  workflow:meta.workflow,
  workflowLabel:workflows[meta.workflow]||meta.workflow,
  birthName:meta.birthName,
  firstName:meta.firstName,
  email:meta.email,
  phone:meta.phone,
  birthDate:meta.birthDate,
  age:meta.age,
  fileCount:meta.files?.length||0,
  incomplete:Boolean(meta.incomplete),
  assignedTo:meta.assignedTo||"",
  adminNotify:meta.adminNotify||"",
  staleDays:staleDaysOf(meta),
  minor:Boolean(meta.answers?.contactName)
 };
}

export function createStorage(dataDir,{files,blobs,blobScope="dossiers"}={}){
 const root=path.resolve(dataDir);
 // Octets des pièces : legacy-fs (défaut) ou backend R2/memory via createFileBlobs. Les meta.json restent locaux.
 const fileStore=files || (blobs?createFileBlobs(blobs,{scope:blobScope}):createLegacyFsBlobStore(root));
 // Écritures sérialisées par dossier (et pour l'index) : deux mises à jour concurrentes ne perdent plus d'entrée d'historique.
 const locks=new Map();
 function withLock(key,fn){
  const run=(locks.get(key)||Promise.resolve()).then(fn);
  const tail=run.catch(()=>{});
  locks.set(key,tail);
  tail.then(()=>{if(locks.get(key)===tail)locks.delete(key);});
  return run;
 }
 async function ensureRoot(){await mkdir(root,{recursive:true,mode:0o700});}
 async function metaPath(id){return path.join(root,id,"meta.json");}
 // Dossier absent, entrée qui n'est pas un répertoire ou meta.json corrompu : null (journalisé), jamais une exception qui remonte à la route.
 async function readMeta(id){
  try{
   const meta=JSON.parse(await readFile(await metaPath(id),"utf8"));
   if(!meta || typeof meta!=="object" || Array.isArray(meta))throw new SyntaxError("structure inattendue");
   return meta;
  }catch(e){
   if(e.code==="ENOENT" || e.code==="ENOTDIR")return null;
   if(e instanceof SyntaxError){console.error("[stockage] meta.json illisible pour "+id+" : "+e.message);return null;}
   throw e;
  }
 }
 async function writeMeta(meta){
  meta.updatedAt=new Date().toISOString();
  const dir=path.join(root,meta.id);
  await mkdir(dir,{recursive:true,mode:0o700});
  await writeJson(path.join(dir,"meta.json"),meta);
  return meta;
 }
 function rebuildIndex(){
  return withLock("index.json",async()=>{
   await ensureRoot();
   const ids=await readdir(root);
   const items=[];
   for(const id of ids){
    if(id.startsWith(".") || id==="index.json")continue;
    const meta=await readMeta(id);
    if(meta)items.push(summary(meta));
   }
   items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
   await writeJson(path.join(root,"index.json"),items);
   return items;
  });
 }
 async function list(filters={}){
  await ensureRoot();
  let items;
  try{items=JSON.parse(await readFile(path.join(root,"index.json"),"utf8"));}catch{items=await rebuildIndex();}
  const q=(filters.q||"").trim().toLowerCase();
  return items.filter(item=>{
   if(filters.workflow && item.workflow!==filters.workflow)return false;
   if(filters.status && item.status!==filters.status)return false;
   if(!q)return true;
   const hay=[item.birthName,item.firstName,item.email,item.phone,item.id].join(" ").toLowerCase();
   return hay.includes(q);
  });
 }
 // deferredCount : pièces que le candidat n'a pas sous la main (à récupérer par AEM), tracées dans l'historique.
 function save(submission,auditText,options={}){return withLock(submission.submissionId,()=>saveUnlocked(submission,auditText,options));}
 async function saveUnlocked(submission,auditText,{incomplete=false,deferredCount=0}={}){
  await ensureRoot();
  const id=submission.submissionId;
  await mkdir(path.join(root,id),{recursive:true,mode:0o700});
  const filesMeta=[];
  const taken=new Set();
  const nowIso=new Date().toISOString();
  const europeSituation=submission.answers?.europeSituation||"";
  for(let i=0;i<submission.uploads.length;i++){
   const file=submission.uploads[i];
   const storedAs=i+"-"+sanitizeName(file.name);
   await fileStore.putFile(id,storedAs,file.content,file.contentType);
   const originalName=file.name;
   const ext=fileExt(originalName);
   // Nouveaux dossiers : displayName aligné sur la nomenclature d’export (sans réécrire les anciens).
   const displayName=exportFileName({birthName:submission.answers.birthName,firstName:submission.answers.firstName,key:file.key,ext,europeSituation,taken});
   filesMeta.push({index:i,key:file.key,name:originalName,originalName,displayName,face:"",size:file.size,contentType:file.contentType,storedAs});
  }
  const meta={
   id,
   createdAt:nowIso,
   finalizedAt:nowIso,
   updatedAt:nowIso,
   status:"received",
   warning7SentAt:"",
   warning3SentAt:"",
   adminNotify:"pending",
   adminNote:"",
   incomplete,
   workflow:submission.answers.workflow,
   birthName:submission.answers.birthName,
   firstName:submission.answers.firstName,
   email:submission.answers.email,
   phone:submission.answers.phone,
   birthDate:submission.answers.birthDate||"",
   age:ageFromDate(submission.answers.birthDate),
   answers:submission.answers,
   files:filesMeta,
   auditText,
   candidateMail:"skipped",
   history:[historyEntry("système","received","Dossier reçu : "+filesMeta.length+" fichier(s)"+(incomplete?", dossier incomplet":"")+(deferredCount?", "+deferredCount+" pièce(s) à récupérer":""))]
  };
  await writeMeta(meta);
  await rebuildIndex();
  return meta;
 }
 async function get(id){
  if(!isSubmissionId(id))return null;
  const meta=await readMeta(id);
  if(!meta)return null;
  meta.history||=[];
  return meta;
 }
 // patch : {status?,adminNote?,candidateMail?,assignedTo?} ; by : identifiant admin ou "système" ; action/details : entrée d'historique supplémentaire.
 function update(id,patch,options={}){
  if(!isSubmissionId(id))return Promise.resolve(null);
  return withLock(id,()=>updateUnlocked(id,patch,options));
 }
 async function updateUnlocked(id,patch,{by="système",action="",details=""}={}){
  const meta=await readMeta(id);
  if(!meta)return null;
  meta.history||=[];
  if(action)meta.history.push(historyEntry(by,action,details));
  if(patch.status && Object.hasOwn(dossierStatuses,patch.status) && patch.status!==meta.status){meta.status=patch.status;meta.history.push(historyEntry(by,"status","Statut : "+dossierStatuses[patch.status]));}
  if(typeof patch.adminNote==="string" && patch.adminNote.slice(0,4000)!==(meta.adminNote||"")){meta.adminNote=patch.adminNote.slice(0,4000);meta.history.push(historyEntry(by,"note",meta.adminNote?"Note interne mise à jour":"Note interne effacée"));}
  if(["sent","failed","skipped"].includes(patch.candidateMail))meta.candidateMail=patch.candidateMail;
  if(["pending","sending","sent","failed","uncertain","skipped"].includes(patch.adminNotify))meta.adminNotify=patch.adminNotify;
  // Métadonnées techniques de notification (non saisissables via patch Admin public).
  if(typeof patch.adminNotifyOpId==="string")meta.adminNotifyOpId=patch.adminNotifyOpId.slice(0,80);
  if(typeof patch.adminNotifyProvider==="string")meta.adminNotifyProvider=patch.adminNotifyProvider.slice(0,32);
  if(typeof patch.adminNotifyProviderId==="string")meta.adminNotifyProviderId=patch.adminNotifyProviderId.slice(0,120);
  if(typeof patch.adminNotifyIdempotencyKey==="string")meta.adminNotifyIdempotencyKey=patch.adminNotifyIdempotencyKey.slice(0,256);
  if(typeof patch.adminNotifyFingerprint==="string")meta.adminNotifyFingerprint=patch.adminNotifyFingerprint.slice(0,128);
  if(typeof patch.adminNotifySentAt==="string")meta.adminNotifySentAt=patch.adminNotifySentAt.slice(0,40);
  if(typeof patch.adminNotifyLastAttemptAt==="string")meta.adminNotifyLastAttemptAt=patch.adminNotifyLastAttemptAt.slice(0,40);
  if(patch.adminNotifyEnvelope && typeof patch.adminNotifyEnvelope==="object" && !Array.isArray(patch.adminNotifyEnvelope)){
   const env=patch.adminNotifyEnvelope;
   meta.adminNotifyEnvelope={
    subject:String(env.subject||"").slice(0,500),
    text:String(env.text||"").slice(0,200000),
    html:env.html==null?"":String(env.html).slice(0,200000),
    from:String(env.from||"").slice(0,320),
    to:String(env.to||"").slice(0,320),
    replyTo:env.replyTo && typeof env.replyTo==="object"
     ?{address:String(env.replyTo.address||"").slice(0,320),name:String(env.replyTo.name||"").slice(0,200)}
     :{address:String(env.replyTo||"").slice(0,320),name:""},
    deferredLabels:Array.isArray(env.deferredLabels)?env.deferredLabels.map(s=>String(s).slice(0,200)).slice(0,40):[],
    attachmentsEnabled:Boolean(env.attachmentsEnabled),
    attachmentNames:Array.isArray(env.attachmentNames)?env.attachmentNames.map(s=>String(s).slice(0,200)).slice(0,60):[]
   };
  }
  if(typeof patch.assignedTo==="string"){
   const who=patch.assignedTo.trim().slice(0,64);
   if(who!==(meta.assignedTo||"")){meta.assignedTo=who;meta.history.push(historyEntry(by,"assign",who?"Suivi par "+who:"Suivi retiré"));}
  }
  if(typeof patch.warning7SentAt==="string")meta.warning7SentAt=patch.warning7SentAt.slice(0,40);
  if(typeof patch.warning3SentAt==="string")meta.warning3SentAt=patch.warning3SentAt.slice(0,40);
  await writeMeta(meta);
  await rebuildIndex();
  return meta;
 }
 // Pièce reçue au comptoir : fichiers ajoutés à la suite de ceux du candidat ; la pièce cesse d'être « à récupérer ».
 function addFiles(id,key,uploads,options={}){
  if(!isSubmissionId(id))return Promise.resolve(null);
  return withLock(id,()=>addFilesUnlocked(id,key,uploads,options));
 }
 async function addFilesUnlocked(id,key,uploads,{by="système",label="",limits=null}={}){
  const meta=await readMeta(id);
  if(!meta)return null;
  meta.files||=[];meta.history||=[];
  if(limits){
   const maxFiles=Number(limits.fileCount)||0,maxBytes=Number(limits.totalBytes)||0;
   if(maxFiles>0 && meta.files.length+uploads.length>maxFiles)throw Object.assign(new Error("Ce dossier atteint déjà la limite de "+maxFiles+" fichiers."),{status:413});
   const existing=meta.files.reduce((n,f)=>n+(Number(f.size)||0),0);
   const incoming=uploads.reduce((n,f)=>n+(Number(f.size)||0),0);
   if(maxBytes>0 && existing+incoming>maxBytes)throw Object.assign(new Error("Ce dossier dépasserait la taille totale autorisée pour les pièces."),{status:413});
  }
  let index=meta.files.reduce((max,f)=>Math.max(max,f.index),-1)+1;
  const taken=new Set((meta.files||[]).map(f=>String(f.displayName||f.name||"").toLowerCase()).filter(Boolean));
  const europeSituation=meta.answers?.europeSituation||"";
  for(const file of uploads){
   const storedAs=index+"-"+sanitizeName(file.name);
   await fileStore.putFile(id,storedAs,file.content,file.contentType);
   const originalName=file.name;
   const displayName=exportFileName({birthName:meta.birthName,firstName:meta.firstName,key,ext:fileExt(originalName),europeSituation,taken});
   meta.files.push({index,key,name:originalName,originalName,displayName,face:"",size:file.size,contentType:file.contentType,storedAs,source:"comptoir",addedAt:new Date().toISOString(),addedBy:String(by).slice(0,64)});
   index++;
  }
  if(Array.isArray(meta.answers?.deferred))meta.answers.deferred=meta.answers.deferred.filter(k=>k!==key);
  meta.incomplete=Boolean(meta.answers?.deferred?.length);
  meta.history.push(historyEntry(by,"upload",(label||key)+" : "+uploads.length+" fichier(s) ajouté(s) au comptoir"));
  await writeMeta(meta);
  await rebuildIndex();
  return meta;
 }
 async function readFileContent(id,index){
  if(!isSubmissionId(id))return null;
  const meta=await readMeta(id);
  if(!meta)return null;
  const file=(meta.files||[]).find(f=>f.index===Number(index));
  if(!file)return null;
  const content=await fileStore.getFile(id,file.storedAs);
  if(!content)return null;
  return {meta,file,content};
 }
 function renameFile(id,index,displayName,{by="système"}={}){
  return patchFile(id,index,{displayName},{by});
 }
 function patchFile(id,index,patch={}, {by="système"}={}){
  if(!isSubmissionId(id))return Promise.resolve(null);
  return withLock(id,async()=>{
   const meta=await readMeta(id);
   if(!meta)return null;
   meta.files||=[];meta.history||=[];
   const file=meta.files.find(f=>f.index===Number(index));
   if(!file)return null;
   let changed=false;
   if(Object.prototype.hasOwnProperty.call(patch,"displayName")){
    const raw=String(patch.displayName||"").trim();
    if(!raw)throw Object.assign(new Error("Nom d’affichage invalide."),{status:400});
    const wanted=sanitizeDisplayBase(raw);
    if(!wanted)throw Object.assign(new Error("Nom d’affichage invalide."),{status:400});
    const ext=fileExt(file.originalName||file.name||file.displayName||"");
    const hasExt=/\.[A-Za-z0-9]{1,8}$/.test(wanted);
    let next=hasExt?wanted:(wanted+"."+(ext||"bin"));
    const taken=new Set(meta.files.filter(f=>f!==file).map(f=>String(f.displayName||f.name||"").toLowerCase()));
    let n=1,base=next.replace(/\.[A-Za-z0-9]{1,8}$/,""),extension=(next.match(/\.([A-Za-z0-9]{1,8})$/)||[])[1]||ext||"bin",candidate=next;
    while(taken.has(candidate.toLowerCase())){n++;candidate=base+" ("+n+")."+extension;}
    if(!file.originalName)file.originalName=file.name;
    file.displayName=candidate;
    meta.history.push(historyEntry(by,"note","Nom d’affichage : "+candidate));
    changed=true;
   }
   if(Object.prototype.hasOwnProperty.call(patch,"face")){
    if(!needsFaceQualification(file.key))throw Object.assign(new Error("Cette pièce ne se qualifie pas en recto/verso."),{status:400});
    const face=normalizeFace(patch.face);
    if(face!==(file.face||"")){
     file.face=face;
     meta.history.push(historyEntry(by,"note","Qualification face : "+(face||"à qualifier")+" (fichier "+file.index+")"));
     changed=true;
    }
   }
   if(!changed)return meta;
   await writeMeta(meta);
   await rebuildIndex();
   return meta;
  });
 }
 function remove(id){
  return withLock(id,async()=>{
   await fileStore.removeAll(id).catch(()=>{});
   await rm(path.join(root,id),{recursive:true,force:true});
   await rebuildIndex();
  });
 }
 // Conservation : effacement `days` jours après finalizedAt (sinon createdAt) ; classé aussi après archivedDays.
 async function purgeOlderThan(days,archivedDays=Math.min(days,90),now=Date.now()){
  if(!days || days<1)return 0;
  const cutoff=now-days*DAY_MS,archivedCutoff=now-archivedDays*DAY_MS;
  const items=await list();
  let removed=0;
  for(const item of items){
   const meta=await readMeta(item.id);
   if(!meta)continue;
   const start=finalizedAtOf(meta);
   const updated=new Date(meta.updatedAt||meta.createdAt).getTime();
   if((start!==null && start<cutoff) || (meta.status==="archived" && updated<archivedCutoff)){
    await remove(meta.id);
    removed++;
   }
  }
  return removed;
 }
 return {root,list,get,save,update,addFiles,renameFile,patchFile,readFileContent,remove,purgeOlderThan,rebuildIndex,fileStore};
}
