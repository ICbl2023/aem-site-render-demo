import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import {readFile,mkdir} from "node:fs/promises";
import {createApp,prepareMail,dossierAdminUrl,isValidEmail} from "../server.js";
import {createStorage} from "../storage.js";
import {candidate,startHarness,form,send,attachmentsFor,png,pdf,heic} from "./helpers.js";

const jsonHeaders={"Content-Type":"application/json","X-AEM-Admin":"1"};
async function login(h,body={password:"test-admin"}){
 const r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
}
const H=cookie=>({...jsonHeaders,Cookie:cookie});

test("isValidEmail et lien admin ?dossier=",()=>{
 assert.equal(isValidEmail("nolan@example.test"),true);
 assert.equal(isValidEmail("pas-un-mail"),false);
 assert.equal(isValidEmail(""),false);
 const id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
 assert.equal(dossierAdminUrl("https://demo.test/admin.html",id),"https://demo.test/admin.html?dossier="+id);
 const mail=prepareMail({submissionId:id,answers:candidate,uploads:[]},{from:"a@b.c",recipient:"admin@example.test"},{adminUrl:dossierAdminUrl("https://x/admin.html",id)});
 assert.ok(mail.text.includes("dossier="+id));
});

test("Demande de piece : succes, aucune piece, email invalide, 502 trace echec",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
  const {cookie}=await login(h);
  const post=(body)=>fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:H(cookie),body:JSON.stringify(body)});
  assert.equal((await post({pieces:[],message:"x"})).status,400);
  let r=await post({pieces:["identity_cni_fr"],message:"Recto illisible"});
  assert.equal(r.status,200);
  assert.equal((await r.json()).sent,true);
  assert.equal((await post({pieces:["jdc"]})).status,409,"debounce 60s");
 }finally{await h.close();}

 const dataDir="test-results/req-fail-"+crypto.randomUUID();
 const receiptDir="test-results/req-fail-r-"+crypto.randomUUID();
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 let calls=0;
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0},transport:{async sendMail(){calls++;if(calls===1)return {accepted:["admin@example.test"]};throw new Error("SMTP down");}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 try{
  const id=crypto.randomUUID();
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  const r=await fetch(url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({pieces:["jdc"],message:"merci"})});
  assert.equal(r.status,502);
  const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.status,"received");
  assert.ok(meta.history.some(e=>e.action==="request" && /echec|échec|SMTP/i.test(e.details)));
 }finally{await new Promise(r=>app.close(r));}
});

test("Notification nouveau dossier : adminNotify sent, doublon refuse, echec+retry, deep link",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
  const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
  assert.ok(meta.history.some(e=>e.action==="admin_notify"));
  assert.ok(h.messages[0].text.includes("dossier="+id));
  const before=h.messages.length;
  assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
  assert.equal(h.messages.length,before);
  const {cookie}=await login(h);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:H(cookie),body:"{}"})).status,409);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id)).status,401);
 }finally{await h.close();}
});

test("Notification : echec SMTP conserve dossier, retry controle, sans auth refuse",async()=>{
 const dataDir="test-results/notify-fail-"+crypto.randomUUID();
 const receiptDir="test-results/notify-fail-r-"+crypto.randomUUID();
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 let fail=true;const sent=[];
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0,adminUrl:"http://test/admin.html"},transport:{async sendMail(mail){if(fail)throw new Error("SMTP failure");sent.push(mail);return {accepted:["admin@example.test"]};}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 const id=crypto.randomUUID();
 try{
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  let meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"failed");
  assert.ok(meta.files.length>0);
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"failed");
  fail=false;
  assert.equal((await fetch(url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:jsonHeaders,body:"{}"})).status,401);
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  const rr=await fetch(url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"{}"});
  assert.equal(rr.status,200);
  meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
  assert.equal(sent.length,1);
  assert.ok(sent[0].text.includes("dossier="+id));
 }finally{await new Promise(r=>app.close(r));}
});

test("Notification interrompue sending -> uncertain au demarrage sans renvoi auto",async()=>{
 const dataDir="test-results/notify-uncertain-"+crypto.randomUUID();
 await mkdir(dataDir,{recursive:true});
 const storage=createStorage(dataDir);
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:{...candidate},uploads:[]},"audit");
 await storage.update(id,{adminNotify:"sending"});
 let sent=0;
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir:dataDir+"-r",dataDir,adminPassword:"x",candidateMail:false,retentionDays:0},transport:{async sendMail(){sent++;throw new Error("should not send");}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 try{
  for(let i=0;i<20;i++){
   const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
   if(meta.adminNotify==="uncertain"){assert.equal(sent,0);return;}
   await new Promise(r=>setTimeout(r,25));
  }
  assert.fail("adminNotify n est pas passe a uncertain");
 }finally{await new Promise(r=>app.close(r));}
});

test("Depot admin formats + limite cumulative fileCount",async()=>{
 const h=await startHarness();
 try{
  const answers={...candidate,deferred:["jdc"]};
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(answers,attachmentsFor(answers).filter(f=>f.key!=="jdc"),id))).status,200);
  const {cookie}=await login(h);
  const upload=async(key,files)=>{const fd=new FormData();fd.append("key",key);for(const [name,content] of files)fd.append("files",new Blob([content]),name);return fetch(h.url+"/api/admin/dossiers/"+id+"/files",{method:"POST",headers:{Cookie:cookie,"X-AEM-Admin":"1"},body:fd});};
  assert.equal((await upload("jdc",[["a.pdf",pdf]])).status,200);
  assert.equal((await upload("jdc",[["b.png",png]])).status,200);
  assert.equal((await upload("jdc",[["d.heic",heic]])).status,200);
  assert.equal((await upload("jdc",[["e.exe",Buffer.from("MZ")]])).status,415);
  assert.equal((await upload("jdc",[])).status,400);
 }finally{await h.close();}

 const storage=createStorage("test-results/cumul-"+crypto.randomUUID());
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:candidate,uploads:[
  {key:"identity_cni_fr",name:"a.pdf",content:pdf,size:pdf.length,contentType:"application/pdf"},
  {key:"jdc",name:"b.pdf",content:pdf,size:pdf.length,contentType:"application/pdf"}
 ]},"audit");
 await assert.rejects(
  ()=>storage.addFiles(id,"jdc",[{name:"c.pdf",content:pdf,size:pdf.length,contentType:"application/pdf"}],{by:"admin",label:"JDC",limits:{fileCount:2,totalBytes:17*1024*1024}}),
  e=>e.status===413
 );
});

test("Page admin.html?dossier= servie ; API dossier protegee",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
  assert.equal((await fetch(h.url+"/admin.html?dossier="+id)).status,200);
  assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id)).status,401);
 }finally{await h.close();}
});


test("Resend mock : submit 200 + sent + retry reutilise la meme cle",async()=>{
 const dataDir="test-results/resend-ok-"+crypto.randomUUID();
 const receiptDir=dataDir+"-r";
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 const bodies=[];
 const mock=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
  bodies.push({key:req.headers["idempotency-key"],subject:body.subject,text:body.text});
  res.writeHead(200,{"Content-Type":"application/json"});
  res.end(JSON.stringify({id:"re-"+bodies.length}));
 });
 await new Promise(r=>mock.listen(0,"127.0.0.1",r));
 const endpoint="http://127.0.0.1:"+mock.address().port+"/emails";
 const app=createApp({
  config:{origin:"http://test",from:"noreply@aem.example",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0,emailProvider:"resend",resendApiKey:"re_test",adminUrl:"http://test/admin.html"},
  resendEndpoint:endpoint
 });
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 const id=crypto.randomUUID();
 try{
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  let meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
  assert.equal(meta.adminNotifyProvider,"resend");
  assert.ok(meta.adminNotifyProviderId);
  assert.equal(meta.adminNotifyIdempotencyKey,"aem-admin-notify/"+id);
  assert.ok(meta.adminNotifyEnvelope?.text);
  assert.equal(bodies.length,1);
  // Forcer failed puis retry : meme cle + meme contenu
  meta=await (await import("../storage.js")).createStorage(dataDir).update(id,{adminNotify:"failed"});
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  assert.equal((await fetch(url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"{}"})).status,200);
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].key,bodies[1].key);
  assert.equal(bodies[0].subject,bodies[1].subject);
  assert.equal(bodies[0].text,bodies[1].text);
  meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
 }finally{
  await new Promise(r=>app.close(r));
  await new Promise(r=>mock.close(r));
 }
});

test("Resend mock : 401 => failed ; timeout => uncertain ; skipped retryable",async()=>{
 const dataDir="test-results/resend-fail-"+crypto.randomUUID();
 const receiptDir=dataDir+"-r";
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 let mode="401";
 const mock=http.createServer(async(req,res)=>{
  for await(const _ of req){}
  if(mode==="hang")return;
  if(mode==="401"){res.writeHead(401,{"Content-Type":"application/json"});res.end(JSON.stringify({message:"no key",name:"missing_api_key"}));return;}
  res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({id:"ok-later"}));
 });
 await new Promise(r=>mock.listen(0,"127.0.0.1",r));
 const endpoint="http://127.0.0.1:"+mock.address().port+"/emails";
 const app=createApp({
  config:{origin:"http://test",from:"noreply@aem.example",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0,emailProvider:"resend",resendApiKey:"re_test",emailTimeoutMs:80,adminUrl:"http://test/admin.html"},
  resendEndpoint:endpoint
 });
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 try{
  const id=crypto.randomUUID();
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)})).status,200);
  assert.equal(JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8")).adminNotify,"failed");

  mode="hang";
  const id2=crypto.randomUUID();
  assert.equal((await fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id2)})).status,200);
  assert.equal(JSON.parse(await readFile(dataDir+"/"+id2+"/meta.json","utf8")).adminNotify,"uncertain");

  // skipped puis messagerie OK => retry
  const storage=(await import("../storage.js")).createStorage(dataDir);
  const id3=crypto.randomUUID();
  await storage.save({submissionId:id3,answers:{...candidate},uploads:[]},"audit");
  await storage.update(id3,{adminNotify:"skipped"});
  mode="ok";
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  const rr=await fetch(url+"/api/admin/dossiers/"+id3+"/notification/retry",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"{}"});
  assert.equal(rr.status,200);
  assert.equal(JSON.parse(await readFile(dataDir+"/"+id3+"/meta.json","utf8")).adminNotify,"sent");
 }finally{
  await new Promise(r=>app.close(r));
  await new Promise(r=>mock.close(r));
 }
});

test("Notification : concurrence submit/retry refusee",async()=>{
 const dataDir="test-results/resend-race-"+crypto.randomUUID();
 const receiptDir=dataDir+"-r";
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 let release;
 const gate=new Promise(r=>release=r);
 let started=0;
 const app=createApp({config:{origin:"http://test",from:"a@b.c",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0},transport:{provider:"custom",async sendMail(){started++;await gate;return {accepted:["admin@example.test"]};}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 const id=crypto.randomUUID();
 try{
  const submitP=fetch(url+"/api/submit",{method:"POST",headers:{Origin:"http://test","X-AEM-Request":"questionnaire"},body:form(candidate,attachmentsFor(candidate),id)});
  for(let i=0;i<40 && started===0;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(started,1);
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  const retry=await fetch(url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"{}"});
  assert.equal(retry.status,409);
  release();
  assert.equal((await submitP).status,200);
 }finally{await new Promise(r=>app.close(r));}
});

test("Ancien dossier sans enveloppe : retry possible apres config",async()=>{
 const dataDir="test-results/legacy-notify-"+crypto.randomUUID();
 await mkdir(dataDir,{recursive:true});
 const storage=createStorage(dataDir);
 const id=crypto.randomUUID();
 await storage.save({submissionId:id,answers:{...candidate},uploads:[]},"audit");
 await storage.update(id,{adminNotify:"skipped"});
 const sent=[];
 const app=createApp({config:{origin:"http://test",from:"a@b.c",recipient:"admin@example.test",receiptDir:dataDir+"-r",dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0,adminUrl:"http://test/admin.html"},transport:{async sendMail(m){sent.push(m);return {accepted:["admin@example.test"]};}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 try{
  const loginR=await fetch(url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify({password:"test-admin"})});
  const cookie=(loginR.headers.get("set-cookie")||"").split(";")[0];
  assert.equal((await fetch(url+"/api/admin/dossiers/"+id+"/notification/retry",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"{}"})).status,200);
  assert.equal(sent.length,1);
  const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
  assert.ok(meta.adminNotifyEnvelope);
 }finally{await new Promise(r=>app.close(r));}
});
