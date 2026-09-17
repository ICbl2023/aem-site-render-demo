import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createApp} from "../server.js";
import {form,attachmentsFor,candidate} from "./helpers.js";
const origin="http://questionnaires.example.test";
async function server(options={}){
 const dir=path.resolve("test-results","standalone-"+crypto.randomUUID());
 const app=createApp({...options,config:{standalone:true,origin,basePath:"/questionnaires",dataDir:dir,receiptDir:dir+"-receipts",adminAccounts:"test:test:responsable",candidateMail:false,retentionDays:0,...options.config}});
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 return {app,url:"http://127.0.0.1:"+app.address().port+"/questionnaires",close:()=>new Promise(resolve=>app.close(resolve))};
}
test("Service autonome sous un préfixe : pages, ressources, assistant écrit, transmission et audit",async()=>{
 const h=await server();
 try{
  for(const name of ["","ants.html","permis.html","app.js","draft-ui.js","drafts.js","draft-remote.js","assist.js","styles.css","fonts/overpass-var.woff2","admin.html"]){
   const response=await fetch(h.url+"/"+name);assert.equal(response.status,200,name);
   assert.match(response.headers.get("permissions-policy"),/microphone=\(\)/);
  }
  for(const name of ["formations.html","index.html/../server.js","voice.js","voice/manifest.json"]){assert.equal((await fetch(h.url+"/"+name)).status,404,name);}
  for(const workflow of ["ants","permis"]){
   const answers={...candidate,workflow,medical:"non"},id=crypto.randomUUID();
   const response=await fetch(h.url+"/api/submit",{method:"POST",headers:{Origin:origin,"X-AEM-Request":"questionnaire"},body:form(answers,attachmentsFor(answers),id)});
   assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,submissionId:id});
   const login=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1",Origin:origin},body:JSON.stringify({user:"test",password:"test"})});
   assert.equal(login.status,200);
   const responseAudit=await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:login.headers.get("set-cookie").split(";")[0]}});
   assert.equal(responseAudit.status,200);
   const data=await responseAudit.json();assert.match((data.dossier||data).auditText,/GRAYSON/);
  }
 }finally{await h.close();}
});
test("Démonstration : un échec de stockage ne confirme jamais l'envoi",async()=>{
 const h=await server({demo:true,storage:{async save(){throw new Error("Stockage indisponible pour le test.");}}});
 try{
  const response=await fetch(h.url+"/api/submit",{method:"POST",headers:{Origin:origin,"X-AEM-Request":"questionnaire"},body:form()});
  assert.equal(response.status,502);assert.equal((await response.json()).ok,false);
 }finally{await h.close();}
});
