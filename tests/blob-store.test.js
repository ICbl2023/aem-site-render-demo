import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createMemoryBlobStore,createFileBlobs,dossierFileKey,draftFileKey} from "../blob-store.js";
import {createStorage} from "../storage.js";
import {createDraftStorage} from "../draft-storage.js";
import {createApp} from "../server.js";
import {candidate,png,pdf} from "./helpers.js";
import {documentsFor} from "../logic.js";

const origin="http://blobs.example.test";

test("Blob memory : put/get/removePrefix sans fuite entre scopes",async()=>{
 const blobs=createMemoryBlobStore();
 await blobs.put(dossierFileKey("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","0-a.pdf"),pdf,{contentType:"application/pdf"});
 await blobs.put(draftFileKey("11111111-1111-4111-8111-111111111111","0-b.png"),png,{contentType:"image/png"});
 assert.equal((await blobs.get(dossierFileKey("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","0-a.pdf"))).body.equals(pdf),true);
 await blobs.removePrefix("brouillons/11111111-1111-4111-8111-111111111111/");
 assert.equal(await blobs.get(draftFileKey("11111111-1111-4111-8111-111111111111","0-b.png")),null);
 assert.ok(await blobs.get(dossierFileKey("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","0-a.pdf")));
});

test("Dossier + brouillon via memory blobs : cycle complet sans fichiers orphelins",async()=>{
 const blobs=createMemoryBlobStore();
 const dir=path.resolve("test-results","blob-cycle-"+crypto.randomUUID());
 const storage=createStorage(dir+"-dossiers",{blobs});
 const drafts=createDraftStorage(dir+"-brouillons",{blobs});
 const {token,draft}=await drafts.create("ants");
 await drafts.addFiles(token,"identity_cni_fr",[{name:"c.png",size:png.length,contentType:"image/png",content:png}],{fileCount:30,totalBytes:17*1024*1024,fileBytes:10*1024*1024});
 const read=await drafts.readFileContent(token,0);
 assert.deepEqual(read.content,png);
 assert.equal([...blobs._objects.keys()].filter(k=>k.includes(draft.draftId)).length,1);

 const now=Date.now()+8*86400000;
 const expired=createDraftStorage(dir+"-brouillons",{blobs,now:()=>now});
 assert.equal(await expired.read(token),null);
 assert.equal([...blobs._objects.keys()].filter(k=>k.includes(draft.draftId)).length,0);

 const id=crypto.randomUUID();
 const uploads=documentsFor(candidate).filter(d=>d.requiredUpload).map(d=>({
  key:d.key,name:d.key+".pdf",size:pdf.length,contentType:"application/pdf",content:pdf
 }));
 await storage.save({submissionId:id,answers:candidate,uploads},"audit");
 assert.ok([...blobs._objects.keys()].some(k=>k.startsWith("dossiers/"+id+"/")));
 assert.deepEqual((await storage.readFileContent(id,0)).content,pdf);
 await storage.remove(id);
 assert.equal([...blobs._objects.keys()].filter(k=>k.includes(id)).length,0);
});

test("HTTP memory blobs : upload, jeton, purge, submit, admin, 3 URLs",async()=>{
 const blobs=createMemoryBlobStore();
 const dir=path.resolve("test-results","blob-http-"+crypto.randomUUID());
 const app=createApp({
  blobs,
  config:{
   standalone:true,origin,dataDir:dir,draftDir:dir+"-brouillons",receiptDir:dir+"-receipts",
   adminAccounts:"test:test:responsable",candidateMail:false,retentionDays:0,blobDriver:"memory"
  }
 });
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const url="http://127.0.0.1:"+app.address().port;
 const hdr=(extra={})=>({"X-AEM-Request":"questionnaire",Origin:origin,...extra});
 try{
  const created=await (await fetch(url+"/api/draft",{method:"POST",headers:{...hdr(),"Content-Type":"application/json"},body:JSON.stringify({workflow:"ants"})})).json();
  const token=created.token;
  await fetch(url+"/api/draft",{method:"PUT",headers:{...hdr({"X-AEM-Draft":token}),"Content-Type":"application/json"},body:JSON.stringify({answers:candidate,step:"identityFiles",revision:0})});
  const fd=new FormData();
  fd.append("key","identity_cni_fr");
  fd.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  assert.equal((await fetch(url+"/api/draft/files",{method:"POST",headers:hdr({"X-AEM-Draft":token}),body:fd})).status,200);
  assert.equal((await fetch(url+"/api/draft/files/0",{headers:hdr({"X-AEM-Draft":token})})).status,200);
  assert.equal((await fetch(url+"/api/draft/files/0")).status,403);
  const bad="00000000-0000-4000-8000-000000000000."+"A".repeat(43);
  assert.equal((await fetch(url+"/api/draft/files/0",{headers:hdr({"X-AEM-Draft":bad})})).status,404);
  assert.ok([...blobs._objects.keys()].some(k=>k.startsWith("brouillons/")));

  assert.equal((await fetch(url+"/api/draft/files/0",{method:"DELETE",headers:hdr({"X-AEM-Draft":token})})).status,200);
  assert.equal([...blobs._objects.keys()].filter(k=>k.includes("/files/")).length,0);

  const fd2=new FormData();
  fd2.append("key","identity_cni_fr");
  fd2.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
  await fetch(url+"/api/draft/files",{method:"POST",headers:hdr({"X-AEM-Draft":token}),body:fd2});

  const docs=documentsFor(candidate).filter(d=>d.requiredUpload);
  const submitFd=new FormData();
  const filesMeta=[];
  docs.forEach((d,i)=>{
   const field="file_"+i;
   const name=d.key+"-demo.pdf";
   filesMeta.push({field,key:d.key,name,size:pdf.length});
   submitFd.append(field,new Blob([pdf],{type:"application/pdf"}),name);
  });
  const submissionId=crypto.randomUUID();
  submitFd.append("payload",JSON.stringify({submissionId,answers:candidate,files:filesMeta}));
  submitFd.append("website","");
  const submitted=await fetch(url+"/api/submit",{method:"POST",headers:hdr({"X-AEM-Draft":token}),body:submitFd});
  assert.equal(submitted.status,200,JSON.stringify(await submitted.clone().json().catch(()=>({}))));
  assert.equal((await fetch(url+"/api/draft",{headers:hdr({"X-AEM-Draft":token})})).status,404);
  assert.equal([...blobs._objects.keys()].filter(k=>k.startsWith("brouillons/")).length,0);
  assert.ok([...blobs._objects.keys()].some(k=>k.startsWith("dossiers/"+submissionId+"/")));

  const login=await fetch(url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1",Origin:origin},body:JSON.stringify({user:"test",password:"test"})});
  const cookie=(login.headers.getSetCookie().find(c=>c.startsWith("aem_admin="))||"").split(";")[0];
  const file=await fetch(url+"/api/admin/dossiers/"+submissionId+"/files/0",{headers:{Cookie:cookie,"X-AEM-Admin":"1",Origin:origin}});
  assert.equal(file.status,200);
  assert.equal((await file.arrayBuffer()).byteLength,pdf.length);

  assert.equal((await fetch(url+"/ants.html")).status,200);
  assert.equal((await fetch(url+"/permis.html")).status,200);
  assert.equal((await fetch(url+"/admin.html")).status,200);
 }finally{await new Promise(r=>app.close(r));}
});

test("createFileBlobs isole dossiers et brouillons",async()=>{
 const blobs=createMemoryBlobStore();
 const dossiers=createFileBlobs(blobs,{scope:"dossiers"});
 const brouillons=createFileBlobs(blobs,{scope:"brouillons"});
 const id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
 await dossiers.putFile(id,"0-a.pdf",pdf,"application/pdf");
 await brouillons.putFile(id,"0-a.pdf",png,"image/png");
 assert.deepEqual(await dossiers.getFile(id,"0-a.pdf"),pdf);
 assert.deepEqual(await brouillons.getFile(id,"0-a.pdf"),png);
 await brouillons.removeAll(id);
 assert.deepEqual(await dossiers.getFile(id,"0-a.pdf"),pdf);
 assert.equal(await brouillons.getFile(id,"0-a.pdf"),null);
});
