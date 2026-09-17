// Brouillons privés au navigateur : IndexedDB conserve les octets, pas des chemins de fichiers.
// Chaque origine, sous-dossier et démarche possède son propre brouillon. Aucune requête réseau.
export const DRAFT_DAYS=7;
export const DRAFT_TTL=DRAFT_DAYS*24*60*60*1000;
export const DRAFT_DB="aem-questionnaire-drafts";
const conflict=()=>Object.assign(new Error("Ce brouillon a été modifié dans un autre onglet. Recharge cette page pour reprendre la dernière version."),{code:"DRAFT_CONFLICT"});
export function createDraftStore(workflow,{scope=new URL(".",location.href).pathname,indexedDB=globalThis.indexedDB,now=()=>Date.now()}={}){
 if(!["ants","permis"].includes(workflow))throw new Error("Questionnaire inconnu.");
 const key=scope+":"+workflow;
 let opening;
 function open(){
  if(opening)return opening;
  opening=new Promise((resolve,reject)=>{
   if(!indexedDB){reject(new Error("Le stockage du navigateur est indisponible."));return;}
   let request,finished=false;
   const timer=setTimeout(()=>finish(new Error("Le stockage du navigateur ne répond pas.")),4000);
   const finish=(error,db)=>{
    if(finished){db?.close();return;}
    finished=true;clearTimeout(timer);error?reject(error):resolve(db);
   };
   try{request=indexedDB.open(DRAFT_DB,1);}catch(error){finish(error);return;}
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("drafts"))request.result.createObjectStore("drafts");};
   request.onerror=()=>finish(request.error);
   request.onblocked=()=>finish(new Error("Ferme les autres onglets du questionnaire puis réessaie."));
   request.onsuccess=()=>{
    const db=request.result;
    db.onversionchange=()=>{db.close();opening=null;};
    finish(null,db);
   };
  }).catch(error=>{opening=null;throw error;});
  return opening;
 }
 async function read(){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction("drafts","readonly"),request=tx.objectStore("drafts").get(key);
   tx.oncomplete=()=>resolve(request.result||null);
   tx.onabort=()=>reject(tx.error||new Error("Lecture du brouillon impossible."));
   tx.onerror=()=>{};
  });
 }
 async function write(record,revision){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts");
   let failure;
   const previous=store.get(key);
   previous.onsuccess=()=>{
    const old=previous.result;
    if((old?.revision||0)!==revision || (old && old.draftId!==record.draftId)){
     failure=conflict();tx.abort();return;
    }
    try{store.put(record,key);}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve(record);
   tx.onabort=()=>reject(failure||tx.error||new Error("Sauvegarde interrompue."));
   tx.onerror=()=>{};
  });
 }
 async function remove(draftId){
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts");
   let failure;
   const previous=store.get(key);
   previous.onsuccess=()=>{
    if(draftId && previous.result && previous.result.draftId!==draftId){failure=conflict();tx.abort();return;}
    try{store.delete(key);}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve();
   tx.onabort=()=>reject(failure||tx.error||new Error("Effacement du brouillon impossible."));
   tx.onerror=()=>{};
  });
 }
 return {
  key,
  async load(){
   const record=await read();
   if(!record)return {record:null};
   if(!Number.isFinite(record.expiresAt) || record.expiresAt<=now()){
    await remove(record.draftId);return {record:null,expired:true};
   }
   if(record.version!==1 || record.workflow!==workflow || !record.answers || typeof record.answers!=="object" || !Array.isArray(record.files)){
    throw new Error("Ce brouillon ne peut pas être lu dans cette version. Tu peux l’effacer avec « Recommencer ».");
   }
   const files=new Map(),missing=[];
   for(const item of record.files){
    if(!item || typeof item.key!=="string" || typeof item.name!=="string")continue;
    if(item.blob instanceof Blob && item.size>0 && item.blob.size===item.size){
     try{
      const file=new File([item.blob],item.name,{type:item.type||item.blob.type,lastModified:item.lastModified||record.savedAt});
      if(!files.has(item.key))files.set(item.key,[]);
      files.get(item.key).push(file);continue;
     }catch{/* Les réponses restent récupérables même si un fichier ne l'est pas. */}
    }
    missing.push({key:item.key,name:item.name,size:item.size,type:item.type,lastModified:item.lastModified});
   }
   return {record,files,missing};
  },
  async save(snapshot,revision=0){
   const savedAt=now();
   const entries=[...snapshot.files.entries()].flatMap(([key,list])=>list.map(file=>({key,name:file.name,size:file.size,type:file.type,lastModified:file.lastModified,blob:file})));
   entries.push(...(snapshot.missing||[]).map(item=>({...item,blob:null})));
   const record={version:1,workflow,remote:snapshot.remote,draftId:snapshot.draftId,submissionId:snapshot.submissionId,answers:JSON.parse(JSON.stringify(snapshot.answers)),step:snapshot.step,editMode:Boolean(snapshot.editMode),revision:revision+1,savedAt,expiresAt:savedAt+DRAFT_TTL,files:entries};
   try{await write(record,revision);}
   catch(error){
    if(error.code==="DRAFT_CONFLICT" || !entries.some(item=>item.blob))throw error;
    // Quota ou stockage des Blob refusé : tenter de préserver au moins les réponses.
    // Le résultat signale explicitement les fichiers absents lors d'une future reprise.
    record.files=entries.map(item=>({...item,blob:null}));
    await write(record,revision);
   }
   return {revision:record.revision,savedAt,expiresAt:record.expiresAt,missingCount:record.files.filter(item=>!item.blob).length};
  },
  remove
 };
}
