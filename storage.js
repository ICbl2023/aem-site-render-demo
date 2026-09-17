import {mkdir,readdir,readFile,writeFile,rename,rm} from "node:fs/promises";
import path from "node:path";
import {ageFromDate,workflows} from "./logic.js";

export const UUID_RE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function isSubmissionId(id){return typeof id==="string" && UUID_RE.test(id);}

export const dossierStatuses = {
 received:"Reçu",
 in_progress:"En cours",
 missing_pieces:"Pièces manquantes",
 ready:"Prêt",
 archived:"Classé"
};

export const historyActions = {received:"Réception",status:"Statut",note:"Note interne",request:"Demande de pièce",candidate_mail:"Mail candidat",assign:"Suivi",upload:"Pièce ajoutée au comptoir",delete:"Suppression"};
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
async function writeJson(target,value){
 await writeFile(target+".tmp",JSON.stringify(value,null,2),{mode:0o600});
 await rename(target+".tmp",target);
}
function summary(meta){
 return {
  id:meta.id,
  createdAt:meta.createdAt,
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
  staleDays:staleDaysOf(meta),
  minor:Boolean(meta.answers?.contactName)
 };
}

export function createStorage(dataDir){
 const root=path.resolve(dataDir);
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
  await mkdir(path.join(dir,"files"),{recursive:true,mode:0o700});
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
  const dir=path.join(root,id);
  await mkdir(path.join(dir,"files"),{recursive:true,mode:0o700});
  const filesMeta=[];
  for(let i=0;i<submission.uploads.length;i++){
   const file=submission.uploads[i];
   const storedAs=i+"-"+sanitizeName(file.name);
   await writeFile(path.join(dir,"files",storedAs),file.content,{mode:0o600});
   filesMeta.push({index:i,key:file.key,name:file.name,size:file.size,contentType:file.contentType,storedAs});
  }
  const meta={
   id,
   createdAt:new Date().toISOString(),
   updatedAt:new Date().toISOString(),
   status:"received",
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
  if(typeof patch.assignedTo==="string"){
   const who=patch.assignedTo.trim().slice(0,64);
   if(who!==(meta.assignedTo||"")){meta.assignedTo=who;meta.history.push(historyEntry(by,"assign",who?"Suivi par "+who:"Suivi retiré"));}
  }
  await writeMeta(meta);
  await rebuildIndex();
  return meta;
 }
 // Pièce reçue au comptoir : fichiers ajoutés à la suite de ceux du candidat ; la pièce cesse d'être « à récupérer ».
 function addFiles(id,key,uploads,options={}){
  if(!isSubmissionId(id))return Promise.resolve(null);
  return withLock(id,()=>addFilesUnlocked(id,key,uploads,options));
 }
 async function addFilesUnlocked(id,key,uploads,{by="système",label=""}={}){
  const meta=await readMeta(id);
  if(!meta)return null;
  meta.files||=[];meta.history||=[];
  const dir=path.join(root,id);
  await mkdir(path.join(dir,"files"),{recursive:true,mode:0o700});
  let index=meta.files.reduce((max,f)=>Math.max(max,f.index),-1)+1;
  for(const file of uploads){
   const storedAs=index+"-"+sanitizeName(file.name);
   await writeFile(path.join(dir,"files",storedAs),file.content,{mode:0o600});
   meta.files.push({index,key,name:file.name,size:file.size,contentType:file.contentType,storedAs,source:"comptoir",addedAt:new Date().toISOString(),addedBy:String(by).slice(0,64)});
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
  let content;
  try{content=await readFile(path.join(root,id,"files",file.storedAs));}catch(e){if(e.code==="ENOENT")return null;throw e;}
  return {meta,file,content};
 }
 function remove(id){
  return withLock(id,async()=>{
   await rm(path.join(root,id),{recursive:true,force:true});
   await rebuildIndex();
  });
 }
 // Conservation : tout dossier est effacé `days` jours après son envoi, quel que soit son statut ; un dossier classé
 // l'est dès `archivedDays` jours après son classement. C'est l'engagement de la politique de confidentialité.
 async function purgeOlderThan(days,archivedDays=Math.min(days,90),now=Date.now()){
  if(!days || days<1)return 0;
  const cutoff=now-days*86400000,archivedCutoff=now-archivedDays*86400000;
  const items=await list();
  let removed=0;
  for(const item of items){
   const created=new Date(item.createdAt).getTime(),updated=new Date(item.updatedAt||item.createdAt).getTime();
   if(created<cutoff || (item.status==="archived" && updated<archivedCutoff)){
    await remove(item.id);
    removed++;
   }
  }
  return removed;
 }
 return {root,list,get,save,update,addFiles,readFileContent,remove,purgeOlderThan,rebuildIndex};
}
