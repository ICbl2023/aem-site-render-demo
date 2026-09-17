import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createRemoteDraftStore} from "../draft-remote.js";

// Portée de ce fichier : le client de brouillon seul, face à une API simulée. Les mêmes scénarios joués contre
// le vrai serveur sont dans drafts-remote.test.js, et contre un vrai navigateur dans drafts-browser.js.
// Deux appareils indépendants ; seule l'API HTTP simulée est commune.
// Le cache reproduit le contrôle de révision IndexedDB, sans nécessiter de navigateur.
const tokenA="11111111-1111-4111-8111-111111111111."+"a".repeat(43);
const tokenB="22222222-2222-4222-8222-222222222222."+"b".repeat(43);
const snapshot=(name="Audrey",files=new Map())=>({draftId:crypto.randomUUID(),submissionId:crypto.randomUUID(),answers:{workflow:"ants",firstName:name},step:"identity",files,missing:[]});
function cache(){
 let value={record:null};
 return {
  async load(){return {...value,record:structuredClone(value.record)};},
  async save(data,revision){
   if((value.record?.revision||0)!==revision || (value.record && value.record.draftId!==data.draftId))throw Object.assign(new Error("Autre onglet"),{code:"DRAFT_CONFLICT"});
   value={record:{...structuredClone(data),revision:revision+1,savedAt:Date.now(),expiresAt:Date.now()+86400000},files:data.files,missing:data.missing};
   return {revision:revision+1,savedAt:value.record.savedAt,expiresAt:value.record.expiresAt,missingCount:0};
  },
  async setRemote(remote,revision,draftId){
   if(value.record?.revision!==revision || value.record?.draftId!==draftId)throw Object.assign(new Error("Autre onglet"),{code:"DRAFT_CONFLICT"});
   value.record.remote=structuredClone(remote);
  },
  async remove(){value={record:null};}
 };
}
function environment(t,token=tokenA){
 const values=new Map([["aem-draft-token:/:ants",token]]);
 t.mock.method(globalThis,"fetch",async()=>{throw new Error("Unexpected network");});
 for(const [key,value] of Object.entries({location:new URL("http://localhost/ants.html"),history:{replaceState(){}},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}})){
  const before=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  t.after(()=>before?Object.defineProperty(globalThis,key,before):delete globalThis[key]);
 }
 return values;
}
// Reproduit le serveur de brouillons : index jamais réattribué, et empreinte du contenu réellement reçu,
// comme draft-storage.js. `legacy` simule un brouillon enregistré avant l'ajout de l'empreinte.
function api(data,{legacy=false}={}){
 let draft={workflow:"ants",answers:data.answers,step:data.step,clientDraftId:data.draftId,submissionId:data.submissionId,revision:1,files:[],savedAt:Date.now(),expiresAt:Date.now()+86400000};
 const requests=[],contents=new Map();
 let nextIndex=0;
 return {
  requests,get draft(){return draft;},set draft(value){draft=value;},offline:false,contents,
  count(method,path){return requests.filter(request=>request.method===method && request.url===path).length;},
  async fetch(url,options){
   requests.push({url,...options});
   if(this.offline)throw new TypeError("Failed to fetch");
   if(url==="./api/draft" && options.method==="GET")return Response.json({draft});
   if(url==="./api/draft" && options.method==="PUT"){
    const body=JSON.parse(options.body);
    if(body.revision!==draft.revision)return Response.json({error:"Modifié ailleurs"},{status:409});
    draft={...draft,...body,revision:draft.revision+1};return Response.json({draft});
   }
   const file=url.match(/^\.\/api\/draft\/files\/(\d+)$/);
   if(file && options.method==="GET"){
    const content=contents.get(Number(file[1]));
    return content?new Response(content):new Response(null,{status:404});
   }
   if(file && options.method==="DELETE"){
    contents.delete(Number(file[1]));
    draft.files=draft.files.filter(f=>f.index!==Number(file[1]));return Response.json({files:draft.files});
   }
   if(url==="./api/draft/files" && options.method==="POST"){
    const key=options.body.get("key");
    for(const [field,blob] of options.body.entries()){
     if(field==="key")continue;
     const content=Buffer.from(await blob.arrayBuffer()),index=nextIndex++;
     contents.set(index,content);
     draft.files.push({index,key,name:blob.name,size:blob.size,contentType:blob.type,sha256:legacy?"":createHash("sha256").update(content).digest("hex")});
    }
    return Response.json({files:draft.files});
   }
   throw new Error("Unexpected request: "+options.method+" "+url);
  }
 };
}
// Deux prises de vue successives sur un iPhone : même nom « image.jpeg », même taille, octets différents.
const shot=text=>new File([text],"image.jpeg",{type:"image/jpeg"});
const attach=file=>new Map([["identity_cni_fr",[file]]]);

test("Brouillon distant : un autre lien hors ligne ne reprend ni les réponses ni les pièces locales",async t=>{
 environment(t);
 const local=cache(),data=snapshot("Privé local",new Map([["identity_cni_fr",[new File(["secret local"],"carte.pdf")]]])),server=api(data);
 const first=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 await first.load();await first.save(data,1);
 location.hash="#r="+tokenB;server.offline=true;
 const other=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 let loaded;
 try{loaded=await other.load();}catch(error){assert.ok(error);}
 assert.ok(!loaded?.record,"un lien non vérifié ne doit pas afficher le brouillon d'un autre lien");
 await assert.rejects(()=>other.save(snapshot("Autre")),"l'écriture doit attendre la vérification du lien");
 assert.equal((await local.load()).record.answers.firstName,"Privé local");
});

test("Brouillon distant : un lien vide ne récupère pas le cache d'un autre brouillon",async t=>{
 environment(t);
 const local=cache(),data=snapshot("Ancien dossier"),server=api(data);
 const first=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 await first.load();await first.save(data,1);
 location.hash="#r="+tokenB;
 server.draft={...server.draft,answers:{workflow:"ants"},clientDraftId:"",submissionId:"",step:"welcome",revision:0};
 const loaded=await createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)}).load();
 assert.equal(loaded.record,null);
});

test("Brouillon distant : réouverture hors ligne puis retour réseau sans 409 contre soi-même",async t=>{
 environment(t);
 const local=cache(),data=snapshot(),server=api(data);
 const first=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 await first.load();await first.save(data,1);
 server.offline=true;
 for(let i=0;i<3;i++)await first.save({...data,answers:{...data.answers,birthName:"HORS LIGNE "+i}},2);
 const reopened=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 const loaded=await reopened.load();
 server.offline=false;
 const restored={...data,answers:loaded.record.answers,files:loaded.files,missing:loaded.missing};
 await reopened.save(restored,loaded.record.revision);
 assert.equal(server.draft.answers.birthName,"HORS LIGNE 2");
});

test("Brouillon distant : un conflit local reste bloqué au réessai sans relecture",async t=>{
 environment(t,"");
 const local=cache(),data=snapshot(),unavailable=async()=>Response.json({error:"Désactivé"},{status:503});
 const first=createRemoteDraftStore("ants",{local,fetcher:unavailable});
 await first.load();await first.save(data);
 const second=createRemoteDraftStore("ants",{local,fetcher:unavailable});await second.load();
 await first.save({...data,answers:{...data.answers,firstName:"Plus récent"}});
 const stale={...data,answers:{...data.answers,firstName:"Ancien onglet"}};
 await assert.rejects(()=>second.save(stale),{code:"DRAFT_CONFLICT"});
 await assert.rejects(()=>second.save(stale),{code:"DRAFT_CONFLICT"});
 assert.equal((await local.load()).record.answers.firstName,"Plus récent");
});

test("Brouillon distant : une photo reprise sous le même nom et la même taille remplace bien l'ancienne",async t=>{
 environment(t);
 const before=shot("ANCIENNE"),after=shot("NOUVELLE");
 assert.equal(before.size,after.size,"le scénario n'a de sens que si les tailles sont identiques");
 const local=cache(),data=snapshot("Audrey",attach(before)),server=api(data);
 const store=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 await store.load();
 const first=await store.save(data,1);
 assert.equal(server.draft.files.length,1);
 const replaced=await store.save({...data,files:attach(after)},first.revision);
 assert.equal(server.draft.files.length,1,"l'ancienne version ne reste pas en double sur le serveur");
 assert.equal(server.contents.get(server.draft.files[0].index).toString(),"NOUVELLE");
 // Le même contenu, re-proposé par un autre objet File, ne déclenche aucun envoi supplémentaire.
 await store.save({...data,files:attach(shot("NOUVELLE"))},replaced.revision);
 assert.equal(server.count("POST","./api/draft/files"),2);
 assert.equal(server.draft.files.length,1);
});

test("Brouillon distant : l'autre appareil ne ressert pas les octets périmés de son cache",async t=>{
 environment(t);
 const phone=cache(),relative=cache();
 const data=snapshot("Audrey",attach(shot("ANCIENNE"))),server=api(data);
 const owner=createRemoteDraftStore("ants",{local:phone,fetcher:server.fetch.bind(server)});
 await owner.load();
 const saved=await owner.save(data,1);
 // Le proche ouvre le lien : il télécharge la pièce, puis la garde dans son propre cache.
 const guest=createRemoteDraftStore("ants",{local:relative,fetcher:server.fetch.bind(server)});
 const received=await guest.load();
 assert.equal(received.downloads,1);
 assert.equal(await received.files.get("identity_cni_fr")[0].text(),"ANCIENNE");
 await guest.save({...received.record,files:received.files,missing:received.missing},received.record.revision);
 assert.equal(server.count("POST","./api/draft/files"),1,"une pièce déjà sur le serveur n'est pas renvoyée");
 // La candidate reprend la photo depuis son téléphone.
 const reloaded=await owner.load();
 assert.equal(reloaded.downloads,0,"le cache du téléphone d'origine reste valable");
 await owner.save({...reloaded.record,files:attach(shot("NOUVELLE")),missing:[]},reloaded.record.revision);
 const again=createRemoteDraftStore("ants",{local:relative,fetcher:server.fetch.bind(server)});
 const updated=await again.load();
 assert.equal(updated.downloads,1,"le cache périmé ne remplace pas le téléchargement");
 assert.equal(await updated.files.get("identity_cni_fr")[0].text(),"NOUVELLE");
 assert.equal(updated.files.get("identity_cni_fr").length,1);
 assert.ok(saved.revision);
});

test("Brouillon distant : un brouillon sans empreinte serveur reste repris sur le nom et la taille",async t=>{
 environment(t);
 const local=cache(),data=snapshot("Audrey",attach(shot("ANCIENNE"))),server=api(data,{legacy:true});
 const store=createRemoteDraftStore("ants",{local,fetcher:server.fetch.bind(server)});
 await store.load();
 const first=await store.save(data,1);
 assert.equal(server.draft.files[0].sha256,"");
 const reloaded=await store.load();
 assert.equal(reloaded.downloads,0);
 await store.save({...reloaded.record,files:reloaded.files,missing:reloaded.missing},reloaded.record.revision);
 assert.equal(server.count("POST","./api/draft/files"),1,"sans empreinte, aucune pièce n'est renvoyée en boucle");
 assert.ok(first.revision);
});

