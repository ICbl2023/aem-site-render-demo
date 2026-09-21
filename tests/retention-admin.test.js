import test from "node:test";
import assert from "node:assert/strict";
import {createStorage,buildDisplayName,DAY_MS,finalizedAtOf} from "../storage.js";
import {expiresAtFrom,freeMailBody,prepareFreeMail,prepareRetentionWarningMail,runRetentionMaintenance} from "../retention.js";
import {cleanAnswers} from "../logic.js";
import {createDraftStorage} from "../draft-storage.js";
import {candidate,startHarness,form,send,attachmentsFor,png,pdf} from "./helpers.js";

const jsonHeaders={"Content-Type":"application/json","X-AEM-Admin":"1"};
async function login(h,body={password:"test-admin"}){
 const r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
}
const mailTo=msg=>(msg.to?.value||[]).map(a=>a.address);

test("finalizedAt posé à la soumission ; expiresAt = finalizedAt + rétention",async()=>{
 const storage=createStorage("test-results/finalized-"+crypto.randomUUID());
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:cleanAnswers(candidate),uploads:[{key:"identity_cni_fr",name:"IMG_1.jpg",content:png,size:png.length,contentType:"image/png"}]},"audit");
 const meta=await storage.get(id);
 assert.ok(meta.finalizedAt);
 assert.equal(meta.finalizedAt,meta.createdAt);
 assert.equal(finalizedAtOf(meta),new Date(meta.finalizedAt).getTime());
 const expires=expiresAtFrom(meta,60);
 assert.equal(new Date(expires).getTime(),new Date(meta.finalizedAt).getTime()+60*DAY_MS);
 assert.equal(expiresAtFrom(meta,0),null);
});

test("displayName métier à la sauvegarde ; originalName et storedAs conservés",async()=>{
 const storage=createStorage("test-results/display-"+crypto.randomUUID());
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:cleanAnswers(candidate),uploads:[
  {key:"identity_cni_fr",name:"IMG_1234.jpg",content:png,size:png.length,contentType:"image/png"},
  {key:"jdc",name:"scan.pdf",content:pdf,size:pdf.length,contentType:"application/pdf"}
 ]},"audit");
 const meta=await storage.get(id);
 const idFile=meta.files.find(f=>f.key==="identity_cni_fr");
 assert.equal(idFile.originalName,"IMG_1234.jpg");
 assert.equal(idFile.name,"IMG_1234.jpg");
 assert.match(idFile.displayName,/^GRAYSON Nolan - .+\.jpg$/i);
 assert.ok(idFile.storedAs.startsWith("0-"));
 assert.notEqual(idFile.displayName,idFile.originalName);
});

test("buildDisplayName : collision homonyme → suffixe (n)",()=>{
 const taken=new Set();
 const a=buildDisplayName({birthName:"Dupont",firstName:"Jean",label:"Carte d'identité",ext:"jpg",taken});
 const b=buildDisplayName({birthName:"Dupont",firstName:"Jean",label:"Carte d'identité",ext:"jpg",taken});
 assert.equal(a,"DUPONT Jean - Carte d'identité.jpg");
 assert.equal(b,"DUPONT Jean - Carte d'identité (2).jpg");
});

test("Alertes J-7 / J-3 idempotentes ; purge à l'échéance ; pas d'alerte sans SMTP",async()=>{
 const storage=createStorage("test-results/retention-"+crypto.randomUUID());
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:cleanAnswers(candidate),uploads:[]},"audit");
 const meta=await storage.get(id);
 const days=60;
 const expires=new Date(meta.finalizedAt).getTime()+days*DAY_MS;
 const sent=[];
 const sendWarning=async(mail)=>sent.push(mail);
 const config={retentionDays:days,from:"aem@example.test",recipient:"admin@example.test"};

 const atJ7=expires-7*DAY_MS+1000;
 let r=await runRetentionMaintenance({storage,config,sendWarning,now:atJ7});
 assert.equal(r.warned7,1);assert.equal(r.warned3,0);assert.equal(sent.length,1);
 assert.match(sent[0].subject,/J-7/);
 assert.equal(sent[0].to,"admin@example.test");

 r=await runRetentionMaintenance({storage,config,sendWarning,now:atJ7});
 assert.equal(r.warned7,0,"pas de doublon J-7");assert.equal(sent.length,1);

 const atJ3=expires-3*DAY_MS+1000;
 r=await runRetentionMaintenance({storage,config,sendWarning,now:atJ3});
 assert.equal(r.warned7,0);assert.equal(r.warned3,1);assert.equal(sent.length,2);
 assert.match(sent[1].subject,/J-3/);

 r=await runRetentionMaintenance({storage,config,sendWarning,now:atJ3});
 assert.equal(r.warned3,0,"pas de doublon J-3");assert.equal(sent.length,2);

 const fresh=await storage.get(id);
 assert.ok(fresh.warning7SentAt);assert.ok(fresh.warning3SentAt);
 assert.ok(fresh.history.some(e=>e.action==="retention_warning" && e.details.includes("J-7")));
 assert.ok(fresh.history.some(e=>e.action==="retention_warning" && e.details.includes("J-3")));

 assert.equal(await runRetentionMaintenance({storage,config,sendWarning:null,now:atJ3}).then(x=>x.warned7+x.warned3),0);

 const afterExpiry=expires+DAY_MS;
 r=await runRetentionMaintenance({storage,config,sendWarning,now:afterExpiry});
 assert.equal(r.removed,1);
 assert.equal((await storage.list()).length,0);
});

test("Sans messagerie : warning*SentAt non posé (réessai possible plus tard)",async()=>{
 const storage=createStorage("test-results/retention-nomail-"+crypto.randomUUID());
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:cleanAnswers(candidate),uploads:[]},"audit");
 const meta=await storage.get(id);
 const days=60;
 const now=new Date(meta.finalizedAt).getTime()+days*DAY_MS-2*DAY_MS;
 await runRetentionMaintenance({storage,config:{retentionDays:days,from:"",recipient:""},sendWarning:null,now});
 const after=await storage.get(id);
 assert.equal(after.warning7SentAt||"","");
 assert.equal(after.warning3SentAt||"","");
});

test("Brouillons : purge dossiers n'efface pas les drafts",async()=>{
 const root="test-results/retention-drafts-"+crypto.randomUUID();
 const storage=createStorage(root+"-dossiers");
 const drafts=createDraftStorage(root+"-brouillons");
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:cleanAnswers(candidate),uploads:[]},"audit");
 const {token}=await drafts.create("ants");
 assert.ok(token);
 const meta=await storage.get(id);
 const old=new Date(Date.now()-400*DAY_MS).toISOString();
 meta.finalizedAt=old;meta.createdAt=old;meta.updatedAt=old;
 const {writeFile}=await import("node:fs/promises");
 await writeFile(storage.root+"/"+id+"/meta.json",JSON.stringify(meta,null,2));
 await storage.rebuildIndex();
 assert.equal(await storage.purgeOlderThan(60),1);
 assert.ok(await drafts.read(token),"brouillon indépendant de la purge dossiers");
});

test("Mail libre admin : envoi, historique email_sent, demande de pièce intacte",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
  const {cookie}=await login(h);
  const headers={...jsonHeaders,Cookie:cookie};
  const mailUrl=h.url+"/api/admin/dossiers/"+id+"/mail";
  assert.equal((await fetch(mailUrl,{method:"POST",headers,body:JSON.stringify({subject:"",message:"x"})})).status,400);
  assert.equal((await fetch(mailUrl,{method:"POST",headers,body:JSON.stringify({subject:"Objet",message:""})})).status,400);
  assert.equal(freeMailBody({subject:"Hello",message:"Corps du message"}).subject,"Hello");
  assert.throws(()=>freeMailBody({subject:"a".repeat(181),message:"ok"}));
  const before=h.messages.length;
  let r=await fetch(mailUrl,{method:"POST",headers,body:JSON.stringify({subject:"Rappel RDV",message:"Bonjour, merci de rappeler l'auto-ecole."})});
  assert.equal(r.status,200);
  const {dossier}=await r.json();
  assert.ok(dossier.history.some(e=>e.action==="email_sent" && e.details.includes("Rappel RDV")));
  assert.equal(h.messages.length,before+1);
  assert.deepEqual(mailTo(h.messages.at(-1)),["nolan@example.test"]);
  assert.equal(h.messages.at(-1).subject,"Rappel RDV");
  const free=prepareFreeMail(dossier,{subject:"X",message:"Y"},{from:"aem@example.test",recipient:"admin@example.test"});
  assert.equal(free.to.address,"nolan@example.test");
  r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers,body:JSON.stringify({pieces:["jdc"],message:"Merci de renvoyer le JDC."})});
  assert.equal(r.status,200);
  assert.equal((await r.json()).dossier.status,"missing_pieces");
 }finally{await h.close();}
});

test("Renommage displayName + Content-Disposition open/download",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  const files=attachmentsFor(candidate).map((f,i)=>i===0?{...f,name:"photo-brute.png",content:png}:f);
  assert.equal((await send(h,form(candidate,files,id))).status,200);
  const {cookie}=await login(h);
  const headers={...jsonHeaders,Cookie:cookie};
  let detail=await (await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).json();
  const file=detail.dossier.files[0];
  assert.equal(file.originalName,"photo-brute.png");
  assert.match(file.displayName,/GRAYSON Nolan/i);
  const renamed="GRAYSON Nolan - CNI recto.png";
  let r=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+file.index,{method:"PATCH",headers,body:JSON.stringify({displayName:renamed})});
  assert.equal(r.status,200);
  detail=(await r.json()).dossier;
  assert.equal(detail.files[0].displayName,renamed);
  assert.equal(detail.files[0].originalName,"photo-brute.png");
  assert.equal(detail.files[0].storedAs,file.storedAs);

  const open=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+file.index,{headers:{Cookie:cookie}});
  assert.equal(open.status,200);
  assert.match(open.headers.get("content-disposition")||"",/^inline;/);
  assert.ok((open.headers.get("content-disposition")||"").includes(encodeURIComponent(renamed)));

  const dl=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+file.index+"?download=1",{headers:{Cookie:cookie}});
  assert.equal(dl.status,200);
  assert.match(dl.headers.get("content-disposition")||"",/^attachment;/);

  r=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+file.index,{method:"PATCH",headers,body:JSON.stringify({displayName:""})});
  assert.equal(r.status,400);
 }finally{await h.close();}
});

test("Upload comptoir (base DnD) : fichier valide, type refusé, auth requise",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  const partial={...candidate,deferred:["jdc"]};
  assert.equal((await send(h,form(partial,attachmentsFor(candidate).filter(f=>f.key!=="jdc"),id))).status,200);
  const {cookie}=await login(h);
  const headers={Cookie:cookie,"X-AEM-Admin":"1"};
  const ok=new FormData();ok.append("key","jdc");ok.append("files",new Blob([pdf]),"jdc-recu.pdf");
  let r=await fetch(h.url+"/api/admin/dossiers/"+id+"/files",{method:"POST",headers,body:ok});
  assert.equal(r.status,200);
  const dossier=(await r.json()).dossier;
  const added=dossier.files.filter(f=>f.key==="jdc" && f.source==="comptoir");
  assert.equal(added.length,1);
  assert.equal(added[0].originalName,"jdc-recu.pdf");
  assert.match(added[0].displayName,/GRAYSON Nolan/i);

  const bad=new FormData();bad.append("key","jdc");bad.append("files",new Blob([Buffer.from("not-a-real-image")]),"virus.exe");
  r=await fetch(h.url+"/api/admin/dossiers/"+id+"/files",{method:"POST",headers,body:bad});
  assert.ok(r.status===415 || r.status===400);

  const noAuth=new FormData();noAuth.append("key","jdc");noAuth.append("files",new Blob([pdf]),"x.pdf");
  r=await fetch(h.url+"/api/admin/dossiers/"+id+"/files",{method:"POST",headers:{"X-AEM-Admin":"1"},body:noAuth});
  assert.equal(r.status,401);

  const wrong=new FormData();wrong.append("key","jdc");wrong.append("files",new Blob([pdf]),"x.pdf");
  r=await fetch(h.url+"/api/admin/dossiers/"+crypto.randomUUID()+"/files",{method:"POST",headers,body:wrong});
  assert.equal(r.status,404);
 }finally{await h.close();}
});

test("prepareRetentionWarningMail : destinataire admin, mentions échéance",()=>{
 const mail=prepareRetentionWarningMail({
  meta:{id:"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",birthName:"DUPONT",firstName:"Jean",workflow:"ants"},
  kind:7,
  expiresAt:new Date("2026-12-01T12:00:00Z").toISOString()
 },{from:"aem@example.test",recipient:"admin@example.test"});
 assert.equal(mail.to,"admin@example.test");
 assert.match(mail.subject,/J-7/);
 assert.ok(mail.text.includes("aaaaaaaa"));
 assert.ok(mail.text.includes("DUPONT"));
});
