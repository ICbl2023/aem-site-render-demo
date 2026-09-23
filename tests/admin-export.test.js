import test from "node:test";
import assert from "node:assert/strict";
import {unzipSync} from "fflate";
import {mkdir} from "node:fs/promises";
import {startHarness,form,send,candidate,attachmentsFor} from "./helpers.js";
import {createApp,prepareMail,dossierAdminUrl} from "../server.js";

async function adminLogin(url){
 const r=await fetch(url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1"},body:JSON.stringify({password:"test-admin"})});
 assert.equal(r.status,200);
 return (r.headers.get("set-cookie")||"").split(";")[0];
}

test("prepareMail destinataire et liens Admin",()=>{
 const id=crypto.randomUUID();
 const mail=prepareMail(
  {submissionId:id,answers:{...candidate,firstName:"Zoe",birthName:"Recammier",workflow:"ants"},uploads:[]},
  {from:"noreply@aem.example",recipient:"aemseve@gmail.com"},
  {adminUrl:dossierAdminUrl("https://demo.test/admin.html",id),adminHomeUrl:"https://demo.test/admin.html"}
 );
 assert.equal(mail.to,"aemseve@gmail.com");
 assert.match(mail.subject,/AEM — Zoe Recammier a soumis son questionnaire/);
 assert.match(mail.text,/questionnaire ANTS/);
 assert.match(mail.text,/Ouvrir l.Admin : https:\/\/demo\.test\/admin\.html/);
 assert.match(mail.text,/Consulter le dossier :/);
 assert.ok(!/dossier est complet/i.test(mail.text));
});

test("Archive ZIP Admin auth et contenu",async()=>{
 const h=await startHarness({port:4191});
 try{
  const answers={...candidate,firstName:"Zoe",birthName:"Recammier",deferred:["jdc"]};
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(answers,attachmentsFor(answers).filter(f=>f.key!=="jdc"),id))).status,200);
  const cookie=await adminLogin(h.url);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id+"/archive.zip")).status,401);
  const ok=await fetch(h.url+"/api/admin/dossiers/"+id+"/archive.zip",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}});
  assert.equal(ok.status,200);
  assert.match(ok.headers.get("content-type")||"",/zip/i);
  assert.equal(ok.headers.get("cache-control"),"no-store");
  const entries=unzipSync(new Uint8Array(await ok.arrayBuffer()));
  const paths=Object.keys(entries);
  assert.ok(paths.every(p=>p.startsWith("RECAMMIER Zoe/") && !p.includes("..")));
  const idEntry=paths.find(p=>/identite|CI/i.test(p) && p.endsWith(".pdf"))||paths.find(p=>p.endsWith(".pdf"));
  assert.ok(idEntry);
  assert.equal(Buffer.from(entries[idEntry]).subarray(0,5).toString(),"%PDF-");
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id+"/export",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,200);
 }finally{await h.close();}
});

test("PATCH face et telechargement CI1",async()=>{
 const h=await startHarness({port:4192});
 try{
  const answers={...candidate,identityDocument:"cni_fr",nationality:"francaise"};
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(answers,attachmentsFor(answers),id))).status,200);
  const cookie=await adminLogin(h.url);
  const detail=await (await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).json();
  const identity=detail.dossier.files.find(f=>String(f.key).startsWith("identity_"));
  assert.ok(identity);
  assert.ok(detail.dossier.exportFiles.some(f=>f.index===identity.index && /identite/i.test(f.exportName)));
  const patched=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+identity.index,{
   method:"PATCH",headers:{Cookie:cookie,"X-AEM-Admin":"1","Content-Type":"application/json"},
   body:JSON.stringify({face:"recto"})
  });
  assert.equal(patched.status,200);
  const body=await patched.json();
  assert.match(body.dossier.exportFiles.find(f=>f.index===identity.index).exportName,/CI1\./);
  const dl=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+identity.index+"?download=1",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}});
  assert.equal(dl.status,200);
  assert.match(dl.headers.get("content-disposition")||"",/CI1/i);
 }finally{await h.close();}
});

test("Notification submit une fois pas sur ZIP",async()=>{
 const sent=[];
 const dataDir="test-results/exp-notify-"+crypto.randomUUID();
 const receiptDir=dataDir+"-r";
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 const app=createApp({
  config:{origin:"http://127.0.0.1",from:"aem@example.test",recipient:"aemseve@gmail.com",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0,adminUrl:"http://127.0.0.1/admin.html"},
  transport:{async sendMail(mail){sent.push(mail);return {accepted:[mail.to]};}}
 });
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 try{
  const id=crypto.randomUUID();
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://127.0.0.1","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  for(let i=0;i<40 && !sent.length;i++)await new Promise(r=>setTimeout(r,50));
  assert.ok(sent.length>=1);
  assert.match(sent[0].subject,/a soumis son questionnaire/);
  assert.equal(sent[0].to,"aemseve@gmail.com");
  const before=sent.length;
  const cookie=await adminLogin(url);
  assert.equal((await fetch(url+"/api/admin/dossiers/"+id+"/archive.zip",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,200);
  assert.equal(sent.length,before);
 }finally{await new Promise(r=>app.close(r));}
});
