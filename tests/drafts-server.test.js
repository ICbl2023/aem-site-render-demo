import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {readdir} from "node:fs/promises";
import {createApp} from "../server.js";
import {createDraftStorage} from "../draft-storage.js";
import {DRAFT_TTL} from "../drafts.js";
import {startHarness,candidate,png,form} from "./helpers.js";

const origin="http://questionnaires.example.test";
async function server(overrides={}){
 const dir=path.resolve("test-results","drafts-"+crypto.randomUUID());
 const app=createApp({config:{standalone:true,origin,dataDir:dir,draftDir:dir+"-brouillons",receiptDir:dir+"-receipts",adminAccounts:"test:test:responsable",candidateMail:false,retentionDays:0,...overrides}});
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 return {app,url:"http://127.0.0.1:"+app.address().port,draftDir:dir+"-brouillons",close:()=>new Promise(resolve=>app.close(resolve))};
}
// Chaque appareil n'a que le jeton : aucun cookie, aucun état partagé. C'est bien ce que vit la mère d'une candidate.
const call=(h,method,{token="",body,path:route="/api/draft"}={})=>fetch(h.url+route,{
 method,
 headers:{"X-AEM-Request":"questionnaire",Origin:origin,...(token?{"X-AEM-Draft":token}:{}),...(body?{"Content-Type":"application/json"}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
});
const answersOf=extra=>({...candidate,...extra});

test("Brouillon partagé : le lien rouvre les réponses depuis un autre appareil, sans cookie ni compte",async()=>{
 const h=await server();
 try{
  const created=await call(h,"POST",{body:{workflow:"ants"}});
  assert.equal(created.status,201);
  const {token,draft}=await created.json();
  assert.match(token,/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(draft.revision,0);

  // Le téléphone d'Audrey enregistre ses réponses. Les pièces passent par une route dédiée (voir test suivant).
  const saved=await call(h,"PUT",{token,body:{answers:answersOf({firstName:"Audrey"}),step:"home",revision:0}});
  assert.equal(saved.status,200);
  const first=(await saved.json()).draft;
  assert.equal(first.revision,1);
  assert.equal(first.answers.firstName,"Audrey");

  // Le téléphone de sa mère : même jeton, aucun autre état.
  const read=await call(h,"GET",{token});
  assert.equal(read.status,200);
  const shared=(await read.json()).draft;
  assert.equal(shared.answers.firstName,"Audrey");
  assert.equal(shared.step,"home");
  assert.deepEqual(shared.files,[]);
  assert.ok(!("secretHash" in shared),"l’empreinte du secret ne doit jamais sortir du serveur");

  // La mère complète : la révision avance et les deux appareils voient la même version.
  const byMother=await call(h,"PUT",{token,body:{answers:answersOf({firstName:"Audrey",homeProof:"quittance"}),step:"summary",revision:1}});
  assert.equal(byMother.status,200);
  assert.equal((await byMother.json()).draft.answers.homeProof,"quittance");
  assert.equal((await (await call(h,"GET",{token})).json()).draft.revision,2);
 }finally{await h.close();}
});

test("Brouillon partagé : une photo déposée suit le lien vers un autre appareil, octet pour octet",async()=>{
 const h=await server();
 try{
  const {token}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  await call(h,"PUT",{token,body:{answers:answersOf({firstName:"Audrey"}),step:"identityFiles",revision:0}});
  const data=new FormData();
  data.append("key","identity_cni_fr");
  data.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  const uploaded=await fetch(h.url+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:data});
  assert.equal(uploaded.status,200);
  const listed=(await uploaded.json()).files;
  assert.equal(listed.length,1);
  assert.equal(listed[0].name,"carte.png");
  assert.equal(listed[0].key,"identity_cni_fr");
  assert.ok(!("storedAs" in listed[0]) && !("secretHash" in listed[0]));

  // Un PUT de réponses ne doit pas effacer les pièces déjà stockées.
  assert.equal((await call(h,"PUT",{token,body:{answers:answersOf({firstName:"Audrey"}),step:"home",revision:1}})).status,200);
  const draft=(await (await call(h,"GET",{token})).json()).draft;
  assert.equal(draft.files.length,1);

  const file=await fetch(h.url+"/api/draft/files/"+listed[0].index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal(file.status,200);
  assert.equal(file.headers.get("content-type"),"image/png");
  assert.match(file.headers.get("content-disposition")||"",/attachment/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);

  // Un autre brouillon, même originaire du même IP, n'ouvre pas cette pièce.
  const {token:other}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  assert.equal((await fetch(h.url+"/api/draft/files/"+listed[0].index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":other}})).status,404);

  const removed=await fetch(h.url+"/api/draft/files/"+listed[0].index,{method:"DELETE",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal(removed.status,200);
  assert.deepEqual((await removed.json()).files,[]);
  assert.equal((await fetch(h.url+"/api/draft/files/"+listed[0].index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}})).status,404);
 }finally{await h.close();}
});

test("Brouillon partagé : un fichier texte ou une pièce sans jeton est refusé",async()=>{
 const h=await server();
 try{
  const {token}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  const bad=new FormData();
  bad.append("key","identity_cni_fr");
  bad.append("file_0",new Blob(["pas une image"],{type:"text/plain"}),"notes.txt");
  assert.equal((await fetch(h.url+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:bad})).status,415);
  const noKey=new FormData();
  noKey.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  assert.equal((await fetch(h.url+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:noKey})).status,400);
  const data=new FormData();
  data.append("key","identity_cni_fr");
  data.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  assert.equal((await fetch(h.url+"/api/draft/files",{method:"POST",headers:{Origin:origin,"X-AEM-Draft":token},body:data})).status,403);
 }finally{await h.close();}
});

test("Brouillon partagé : deux appareils simultanés ne s’écrasent pas (409 DRAFT_CONFLICT)",async()=>{
 const h=await server();
 try{
  const {token}=await (await call(h,"POST",{body:{workflow:"permis"}})).json();
  assert.equal((await call(h,"PUT",{token,body:{answers:answersOf({workflow:"permis"}),step:"identity",revision:0}})).status,200);
  // La mère avait chargé la révision 0 et enregistre sans avoir vu la modification d'Audrey.
  const stale=await call(h,"PUT",{token,body:{answers:answersOf({workflow:"permis",firstName:"Autre"}),step:"identity",revision:0}});
  assert.equal(stale.status,409);
  const body=await stale.json();
  assert.equal(body.code,"DRAFT_CONFLICT");
  assert.match(body.error,/modifié ailleurs/);
  // La version d'Audrey est intacte.
  assert.notEqual((await (await call(h,"GET",{token})).json()).draft.answers.firstName,"Autre");
 }finally{await h.close();}
});

test("Brouillon partagé : un jeton faux, tronqué ou d’un autre brouillon n’ouvre rien",async()=>{
 const h=await server();
 try{
  const {token}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  const {token:other}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  const [draftId,secret]=token.split(".");
  const forged=[
   "",
   draftId,
   token+".suffixe",
   token+".",
   draftId+"."+other.split(".")[1], // identifiant d'un brouillon, secret d'un autre
   draftId+"."+secret.slice(0,-1)+(secret.at(-1)==="A"?"B":"A"),
   crypto.randomUUID()+"."+secret,
   "../../etc/passwd."+secret
  ];
  for(const value of forged)assert.equal((await call(h,"GET",{token:value})).status,404,"jeton refusé : "+value);
  assert.equal((await call(h,"GET",{token})).status,200);
 }finally{await h.close();}
});

test("Brouillon partagé : effacement immédiat, et réponses nettoyées comme à l’envoi",async()=>{
 const h=await server();
 try{
  const {token}=await (await call(h,"POST",{body:{workflow:"ants"}})).json();
  // Clé inconnue et champ hors branche : cleanAnswers les écarte, le brouillon ne stocke rien d'arbitraire.
  const saved=await call(h,"PUT",{token,body:{answers:{...answersOf({}),inventé:"x".repeat(50)},step:"identity",revision:0}});
  assert.equal(saved.status,200);
  const stored=(await saved.json()).draft.answers;
  assert.ok(!("inventé" in stored));
  assert.equal(stored.workflow,"ants");

  assert.equal((await call(h,"DELETE",{token})).status,200);
  assert.equal((await call(h,"GET",{token})).status,404);
  assert.deepEqual(await readdir(h.draftDir).catch(()=>[]),[]);
 }finally{await h.close();}
});

test("Brouillon partagé : requête d’un autre site refusée, méthode inconnue refusée",async()=>{
 const h=await server();
 try{
  // Sans l'en-tête maison : un formulaire d'un autre site ne peut pas piloter le brouillon.
  const noHeader=await fetch(h.url+"/api/draft",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin},body:JSON.stringify({workflow:"ants"})});
  assert.equal(noHeader.status,403);
  const foreign=await fetch(h.url+"/api/draft",{method:"POST",headers:{"X-AEM-Request":"questionnaire","Content-Type":"application/json",Origin:"http://pirate.example.test"},body:JSON.stringify({workflow:"ants"})});
  assert.equal(foreign.status,403);
  assert.equal((await call(h,"POST",{body:{workflow:"inconnu"}})).status,400);
  assert.equal((await call(h,"PATCH",{token:""})).status,405);
 }finally{await h.close();}
});

test("Brouillon partagé : désactivable, et absent de /api/config quand il l’est",async()=>{
 const h=await server({drafts:false});
 try{
  assert.equal((await (await fetch(h.url+"/api/config")).json()).drafts,false);
  assert.equal((await call(h,"POST",{body:{workflow:"ants"}})).status,503);
 }finally{await h.close();}
 const on=await server();
 try{
  const config=await (await fetch(on.url+"/api/config")).json();
  assert.equal(config.drafts,true);
  assert.equal(config.draftDays,7);
 }finally{await on.close();}
});

test("Lien de reprise par e-mail : transférable à un proche, plafonné par adresse",async()=>{
 const dir=path.resolve("test-results","drafts-mail-"+crypto.randomUUID());
 const h=await startHarness({draftDir:dir,standalone:true});
 const token=await (async()=>{
  const created=await fetch(h.url+"/api/draft",{method:"POST",headers:{"X-AEM-Request":"questionnaire","Content-Type":"application/json",Origin:h.origin},body:JSON.stringify({workflow:"ants"})});
  assert.equal(created.status,201);
  return (await created.json()).token;
 })();
 const link=(email,body={})=>fetch(h.url+"/api/draft/link",{method:"POST",headers:{"X-AEM-Request":"questionnaire","X-AEM-Draft":token,"Content-Type":"application/json",Origin:h.origin},body:JSON.stringify({email,...body})});
 try{
  await fetch(h.url+"/api/draft",{method:"PUT",headers:{"X-AEM-Request":"questionnaire","X-AEM-Draft":token,"Content-Type":"application/json",Origin:h.origin},body:JSON.stringify({answers:{...candidate,firstName:"Audrey"},step:"home",revision:0})});
  assert.equal((await link("pas-une-adresse")).status,400);
  const sent=await link("maman@example.test");
  assert.equal(sent.status,200);
  const mail=h.messages.at(-1);
  assert.equal(mail.to.value[0].address,"maman@example.test");
  assert.match(mail.subject,/reprenez votre dossier/i);
  assert.ok(mail.text.includes("#r="+token),"le mail doit porter le lien complet");
  assert.match(mail.text,/Audrey/);
  assert.match(mail.text,/ne le publiez pas/i);
  // Plafond de 5 envois par adresse et par 24 h : le formulaire ne doit pas servir de relais de courrier.
  for(let i=0;i<4;i++)assert.equal((await link("maman@example.test")).status,200);
  assert.equal((await link("maman@example.test")).status,429);
 }finally{await h.close();}
});

test("Brouillon partagé : expiration après sept jours, purge des brouillons abandonnés",async()=>{
 let now=Date.UTC(2026,8,17,10,0,0);
 const dir=path.resolve("test-results","drafts-ttl-"+crypto.randomUUID());
 const store=createDraftStorage(dir,{now:()=>now});
 const {token}=await store.create("ants");
 await store.save(token,{answers:{firstName:"Loris"},step:"identity"},0);
 assert.equal((await store.read(token)).answers.firstName,"Loris");

 // Chaque modification repousse l'échéance : six jours d'inactivité ne suffisent pas à perdre le dossier.
 now+=6*86400000;
 assert.ok(await store.read(token));
 const renewed=await store.save(token,{answers:{firstName:"Loris"},step:"home"},1);
 assert.equal(renewed.expiresAt,now+DRAFT_TTL);

 now+=DRAFT_TTL+1;
 assert.equal(await store.read(token),null);
 assert.equal(await store.purgeExpired(),0,"le brouillon expiré est effacé dès sa relecture");
 assert.deepEqual(await readdir(dir).catch(()=>[]),[]);

 // Brouillon jamais rouvert : seule la purge quotidienne peut le retirer du disque.
 const abandoned=await store.create("permis");
 await store.save(abandoned.token,{answers:{firstName:"Oublié"},step:"identity"},0);
 now+=DRAFT_TTL+1;
 assert.equal(await store.purgeExpired(),1);
 assert.deepEqual(await readdir(dir).catch(()=>[]),[]);
});

test("Brouillon partagé : redémarrage du serveur, mêmes réponses et mêmes octets de pièces",async()=>{
 const dir=path.resolve("test-results","drafts-restart-"+crypto.randomUUID());
 const dataDir=dir+"-dossiers",draftDir=dir+"-brouillons",receiptDir=dir+"-receipts";
 const boot=()=>server({dataDir,draftDir,receiptDir});
 const first=await boot();
 let token,index;
 try{
  ({token}=await (await call(first,"POST",{body:{workflow:"ants"}})).json());
  await call(first,"PUT",{token,body:{answers:answersOf({firstName:"Audrey"}),step:"identityFiles",revision:0}});
  const data=new FormData();
  data.append("key","identity_cni_fr");
  data.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  const uploaded=await fetch(first.url+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:data});
  assert.equal(uploaded.status,200);
  index=(await uploaded.json()).files[0].index;
 }finally{await first.close();}

 const second=await boot();
 try{
  const read=await call(second,"GET",{token});
  assert.equal(read.status,200);
  const draft=(await read.json()).draft;
  assert.equal(draft.answers.firstName,"Audrey");
  assert.equal(draft.files[0].name,"carte.png");
  const file=await fetch(second.url+"/api/draft/files/"+index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal(file.status,200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
 }finally{await second.close();}
});

test("Brouillon partagé : invisible de l’admin, fichiers inaccessibles sans jeton, invalidé à l’envoi",async()=>{
 const h=await server();
 try{
  const created=await call(h,"POST",{body:{workflow:"ants"}});
  const {token,draft}=await created.json();
  const draftId=draft.draftId;
  await call(h,"PUT",{token,body:{answers:answersOf({firstName:"Audrey"}),step:"identityFiles",revision:0}});
  const data=new FormData();
  data.append("key","identity_cni_fr");
  data.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  const uploaded=await fetch(h.url+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:data});
  assert.equal(uploaded.status,200);
  const index=(await uploaded.json()).files[0].index;

  // Sans jeton, sans en-tête maison, ou avec un jeton d’un autre dossier : rien n’est servi.
  assert.equal((await fetch(h.url+"/api/draft/files/"+index)).status,403);
  assert.equal((await fetch(h.url+"/api/draft/files/"+index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin}})).status,404);
  const gone=await call(h,"GET",{token:"not-a-token"});
  assert.equal(gone.status,404);
  const body=await gone.json();
  assert.ok(!JSON.stringify(body).includes(draftId),"un jeton invalide ne révèle pas l’identifiant");
  assert.ok(!("secretHash" in body) && !("draft" in body));

  // L’espace admin ne voit pas un brouillon non envoyé, même en connaissant l’UUID.
  const login=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1",Origin:origin},body:JSON.stringify({user:"test",password:"test"})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const list=await (await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).json();
  assert.equal((list.items||[]).length,0);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+draftId,{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,404);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+draftId+"/files/0",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,404);

  const submitted=await fetch(h.url+"/api/submit",{method:"POST",headers:{Origin:origin,"X-AEM-Request":"questionnaire","X-AEM-Draft":token},body:form(answersOf({firstName:"Audrey"}))});
  assert.equal(submitted.status,200,(await submitted.clone().text()));
  assert.equal((await call(h,"GET",{token})).status,404,"le lien de reprise est mort après l’envoi");
  assert.equal((await fetch(h.url+"/api/draft/files/"+index,{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}})).status,404);

  const after=await (await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).json();
  assert.equal((after.items||[]).length,1,"seul le dossier envoyé apparaît dans l’admin");
  assert.notEqual(after.items[0].id,draftId);
 }finally{await h.close();}
});
