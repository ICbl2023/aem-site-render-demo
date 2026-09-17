import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createApp} from "../server.js";
import {createRemoteDraftStore} from "../draft-remote.js";

// Portée de ce fichier : le client de brouillon branché sur le vrai serveur HTTP. Les mêmes règles vues du
// client seul sont dans draft-remote.test.js, et jouées dans un vrai navigateur par drafts-browser.js.
// Cache injecté pour isoler les échanges HTTP. Les scénarios navigateur couvrent le vrai IndexedDB.
function memoryCache(){
 let loaded={record:null};
 return {
  async load(){return loaded;},
  async save(snapshot,revision){
   if((loaded.record?.revision||0)!==revision || (loaded.record && loaded.record.draftId!==snapshot.draftId))
    throw Object.assign(new Error("Conflit local"),{code:"DRAFT_CONFLICT"});
   const record={...snapshot,revision:revision+1,savedAt:Date.now(),expiresAt:Date.now()+604800000};
   loaded={record,files:snapshot.files,missing:snapshot.missing};
   return {revision:record.revision,savedAt:record.savedAt,expiresAt:record.expiresAt,missingCount:0};
  },
  async remove(draftId){
   if(draftId && loaded.record && loaded.record.draftId!==draftId)throw Object.assign(new Error("Conflit local"),{code:"DRAFT_CONFLICT"});
   loaded={record:null};
  }
 };
}
const snapshot=(firstName,draftId=crypto.randomUUID())=>({draftId,submissionId:crypto.randomUUID(),answers:{workflow:"ants",firstName},step:"identity",files:new Map(),missing:[]});

async function harness(t){
 const dir=path.resolve("test-results","remote-"+crypto.randomUUID());
 const origin="http://questionnaires.example.test";
 const app=createApp({config:{standalone:true,origin,dataDir:dir,draftDir:dir+"-drafts",receiptDir:dir+"-receipts",candidateMail:false,retentionDays:0,aiEnabled:false,smtpHost:"",from:"",recipient:""}});
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 t.after(()=>new Promise(resolve=>app.close(resolve)));
 const values=new Map(),href=origin+"/ants.html";
 for(const [name,value] of Object.entries({location:new URL(href),history:{replaceState(_state,_title,url){globalThis.location=new URL(url,href);}},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}})){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  t.after(()=>previous?Object.defineProperty(globalThis,name,previous):delete globalThis[name]);
 }
 const fetcher=(url,options)=>fetch("http://127.0.0.1:"+app.address().port+url.slice(1),{...options,headers:{...options.headers,Origin:origin}});
 const local=memoryCache();
 const store=(cache=local,request=fetcher)=>createRemoteDraftStore("ants",{scope:"/",local:cache,fetcher:request});
 const create=async()=>{
  const response=await fetcher("./api/draft",{method:"POST",headers:{"X-AEM-Request":"questionnaire","Content-Type":"application/json"},body:JSON.stringify({workflow:"ants"})});
  return (await response.json()).token;
 };
 return {local,store,create,values,fetcher};
}

test("Client brouillon : l'absence de mail ne désactive pas les sauvegardes serveur",async t=>{
 const h=await harness(t),store=h.store(),data=snapshot("Audrey");
 const saved=await store.save(data);
 await assert.rejects(store.sendLink("audrey@example.test"));
 data.answers={...data.answers,firstName:"Audrey modifiée"};
 const next=await store.save(data,saved.revision);
 assert.equal(next.shared,true);
 const loaded=await h.store(memoryCache()).load();
 assert.equal(loaded.record.answers.firstName,"Audrey modifiée");
});

test("Client brouillon : ouvrir un lien vide ne lui transfère pas le dossier local précédent",async t=>{
 const h=await harness(t),data=snapshot("Dossier précédent");
 await h.store().save(data);
 const other=await h.create();
 location.hash="#r="+other;
 const next=h.store(),loaded=await next.load();
 assert.equal(loaded.record,null);
 await next.save(snapshot("Nouveau dossier"));
 const reread=await h.store(memoryCache()).load();
 assert.equal(reread.record.answers.firstName,"Nouveau dossier");
});

test("Client brouillon : un autre lien inaccessible ne restaure ni ne téléverse le cache précédent",async t=>{
 const h=await harness(t),data=snapshot("Dossier privé précédent");
 await h.store().save(data);
 const previous=h.values.get("aem-draft-token:/:ants"),other=await h.create();
 location.hash="#r="+other;
 const unavailable=h.store(h.local,async()=>{throw new TypeError("Hors ligne simulé");});
 await assert.rejects(unavailable.load());
 await assert.rejects(unavailable.save(data));
 assert.equal((await h.local.load()).record.answers.firstName,"Dossier privé précédent");
 assert.equal(h.values.get("aem-draft-token:/:ants"),previous);
 assert.equal(location.hash,"#r="+other,"le lien reste disponible pour une nouvelle tentative");
});

test("Client brouillon : réessayer après un conflit local ne remplace pas le cache plus récent",async t=>{
 const h=await harness(t),data=snapshot("Initial");
 const first=h.store();await first.save(data);
 const second=h.store();await second.load();
 const latest={...data,answers:{...data.answers,firstName:"Version récente"}};
 await first.save(latest,1);
 for(let attempt=0;attempt<2;attempt++){
  await assert.rejects(second.save({...data,answers:{...data.answers,firstName:"Version périmée"}},1),{code:"DRAFT_CONFLICT"});
  assert.equal((await h.local.load()).record.answers.firstName,"Version récente");
 }
});

test("Client brouillon : après rechargement hors ligne, la révision reste celle du serveur",async t=>{
 const h=await harness(t),data=snapshot("Audrey");
 const connected=h.store();const initial=await connected.save(data);
 const offline=h.store(h.local,async()=>{throw new TypeError("Réseau coupé");});
 const loaded=await offline.load();
 data.answers={...data.answers,firstName:"Saisie hors ligne"};
 await offline.save(data,loaded.record.revision);
 await offline.save(data,loaded.record.revision);
 const reopened=h.store(h.local,async()=>{throw new TypeError("Réseau coupé");});
 const resumed=await reopened.load();
 assert.equal(resumed.record.revision,initial.revision);
 assert.equal(resumed.record.answers.firstName,"Saisie hors ligne");
});

test("Client brouillon : revenir en ligne après fermeture conserve la saisie non synchronisée",async t=>{
 const h=await harness(t),data=snapshot("Audrey");
 const connected=h.store();await connected.save(data);
 let networkDown=false;
 const offline=h.store(h.local,async(url,options)=>{
  if(networkDown)throw new TypeError("Réseau coupé");
  return h.fetcher(url,options);
 });
 const before=await offline.load();networkDown=true;
 data.answers={...data.answers,firstName:"À synchroniser"};
 await offline.save(data,before.record.revision);
 const reopened=h.store(),resumed=await reopened.load();
 assert.equal(resumed.record.answers.firstName,"À synchroniser");
 assert.equal(resumed.pending,true);
 const saved=await reopened.save({...resumed.record,files:resumed.files,missing:resumed.missing},resumed.record.revision);
 assert.equal(saved.shared,true);
 assert.equal((await h.store(memoryCache()).load()).record.answers.firstName,"À synchroniser");
});
test("Client brouillon : des fichiers homonymes de deux brouillons ne se mélangent pas",async t=>{
 const h=await harness(t),first=snapshot("Premier"),second=snapshot("Second");
 first.files=new Map([["identity_cni_fr",[new File(["%PDF-1.4\nPREMIER"],"carte.pdf",{type:"application/pdf"})]]]);
 second.files=new Map([["identity_cni_fr",[new File(["%PDF-1.4\nSECOND!"],"carte.pdf",{type:"application/pdf"})]]]);
 await h.store().save(first);
 // Un autre appareil crée son propre dossier, avec les mêmes nom, taille et destination de fichier.
 h.values.clear();await h.store(memoryCache()).save(second);
 const other=h.values.get("aem-draft-token:/:ants");location.hash="#r="+other;
 const loaded=await h.store().load();
 assert.equal(loaded.record.answers.firstName,"Second");
 assert.equal(await loaded.files.get("identity_cni_fr")[0].text(),"%PDF-1.4\nSECOND!");
});

test("Client brouillon : une pièce reprise sous le même nom et la même taille atteint l'autre appareil",async t=>{
 const h=await harness(t),data=snapshot("Audrey");
 // Deux versions du même document : nom identique, taille identique, contenu différent — le cas d'une photo
 // refaite depuis un iPhone, où toutes les prises de vue s'appellent pareil et pèsent presque pareil.
 const before=new File(["%PDF-1.4\nPREMIER"],"image.pdf",{type:"application/pdf"});
 const after=new File(["%PDF-1.4\nSECOND!"],"image.pdf",{type:"application/pdf"});
 assert.equal(before.size,after.size);
 data.files=new Map([["identity_cni_fr",[before]]]);
 const phone=h.store();
 await phone.save(data);
 // Le proche ouvre le lien et met la première version dans son propre cache.
 const relativeCache=memoryCache(),relative=h.store(relativeCache);
 const received=await relative.load();
 assert.equal(await received.files.get("identity_cni_fr")[0].text(),"%PDF-1.4\nPREMIER");
 await relative.save({...received.record,files:received.files,missing:received.missing},received.record.revision);
 // La candidate refait la photo sur son téléphone.
 const reloaded=await phone.load();
 await phone.save({...reloaded.record,files:new Map([["identity_cni_fr",[after]]]),missing:[]},reloaded.record.revision);
 const resumed=await h.store(relativeCache).load();
 assert.equal(resumed.files.get("identity_cni_fr").length,1,"l'ancienne version ne subsiste pas à côté de la nouvelle");
 assert.equal(await resumed.files.get("identity_cni_fr")[0].text(),"%PDF-1.4\nSECOND!");
});

test("Client brouillon : une modification distante pendant la coupure est signalée et préservée",async t=>{
 const h=await harness(t),data=snapshot("Audrey");
 await h.store().save(data);
 const other=h.store(memoryCache()),remote=await other.load();
 const offline=h.store(h.local,async()=>{throw new TypeError("Réseau coupé");});
 const cached=await offline.load();
 await offline.save({...data,answers:{...data.answers,firstName:"Saisie locale"}},cached.record.revision);
 await other.save({...remote.record,answers:{...remote.record.answers,firstName:"Saisie distante"},files:remote.files,missing:remote.missing},remote.record.revision);
 const reopened=await h.store().load();
 assert.equal(reopened.conflict,true);
 assert.equal(reopened.record.answers.firstName,"Saisie distante");
 assert.equal((await h.local.load()).record.answers.firstName,"Saisie locale","le cache non fusionné est encore conservé à la lecture");
});