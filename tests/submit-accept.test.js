import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,readdir} from "node:fs/promises";
import path from "node:path";
import {createApp} from "../server.js";
import {candidate,form,send,attachmentsFor,startHarness} from "./helpers.js";

async function listen(app){
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 return {url:"http://127.0.0.1:"+app.address().port,origin:"http://test",close:()=>new Promise(r=>app.close(r))};
}

test("stockage OK + SMTP OK → 200 + sent",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  const r=await send(h,form(candidate,attachmentsFor(candidate),id));
  assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
  assert.equal(h.messages.length,1);
 }finally{await h.close();}
});

test("stockage OK + SMTP échoué → 200 + failed",async()=>{
 const dataDir=path.resolve("test-results","accept-fail-"+crypto.randomUUID());
 const receiptDir=path.resolve("test-results","accept-fail-r-"+crypto.randomUUID());
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,candidateMail:false,retentionDays:0},transport:{async sendMail(){throw new Error("SMTP failure");}}});
 const h=await listen(app);
 try{
  const id=crypto.randomUUID();
  const r=await send(h,form(candidate,attachmentsFor(candidate),id));
  assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"failed");
  assert.ok((meta.files||[]).length>0);
 }finally{await h.close();}
});

test("stockage OK + SMTP incertain → 200 + uncertain",async()=>{
 const dataDir=path.resolve("test-results","accept-unc-"+crypto.randomUUID());
 const receiptDir=path.resolve("test-results","accept-unc-r-"+crypto.randomUUID());
 await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,candidateMail:false,retentionDays:0},transport:{async sendMail(){const e=new Error("SMTP timeout");e.code="ETIMEDOUT";throw e;}}});
 const h=await listen(app);
 try{
  const id=crypto.randomUUID();
  const r=await send(h,form(candidate,attachmentsFor(candidate),id));
  assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
  const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"uncertain");
 }finally{await h.close();}
});

test("stockage échoué → erreur HTTP",async()=>{
 const receiptDir=path.resolve("test-results","accept-store-r-"+crypto.randomUUID());
 await mkdir(receiptDir,{recursive:true});
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir:path.resolve("test-results","accept-store-"+crypto.randomUUID()),candidateMail:false,retentionDays:0},storage:{async save(){throw new Error("Stockage indisponible pour le test.");},async list(){return [];},async update(){throw new Error("noop");}},transport:{async sendMail(){return {accepted:["admin@example.test"]};}}});
 const h=await listen(app);
 try{
  const r=await send(h,form(candidate,attachmentsFor(candidate)));
  assert.ok(r.status>=400);assert.equal((await r.json()).ok,false);
  assert.equal((await readdir(receiptDir)).filter(n=>n.endsWith(".json")).length,0);
 }finally{await h.close();}
});

test("reçu non persisté → erreur HTTP",async()=>{
 const dataDir=path.resolve("test-results","accept-rec-"+crypto.randomUUID());
 const receiptPath=path.resolve("test-results","accept-rec-file-"+crypto.randomUUID());
 await mkdir(dataDir,{recursive:true});
 await writeFile(receiptPath,"pas-un-dossier");
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir:receiptPath,dataDir,candidateMail:false,retentionDays:0},transport:{async sendMail(){return {accepted:["admin@example.test"]};}}});
 const h=await listen(app);
 try{
  const id=crypto.randomUUID();
  const r=await send(h,form(candidate,attachmentsFor(candidate),id));
  assert.ok(r.status>=400);assert.equal((await r.json()).ok,false);
  // Le dossier peut avoir été écrit avant l’échec du reçu : pas de confirmation candidat.
  const receipts=await readdir(path.dirname(receiptPath)).catch(()=>[]);
  assert.equal(receipts.filter(n=>n.startsWith(path.basename(receiptPath)) && n.endsWith(".json")).length,0);
 }finally{await h.close();}
});

test("nouvelle soumission identique → pas de nouveau dossier",async()=>{
 const h=await startHarness();
 try{
  const id=crypto.randomUUID();
  const body=()=>form(candidate,attachmentsFor(candidate),id);
  assert.equal((await send(h,body())).status,200);
  assert.equal((await send(h,body())).status,200);
  const dirs=(await readdir(h.dataDir,{withFileTypes:true})).filter(d=>d.isDirectory() && /^[a-f0-9-]{36}$/i.test(d.name));
  assert.equal(dirs.length,1);
  assert.equal(dirs[0].name,id);
  assert.equal(h.messages.length,1);
  const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
  assert.equal(meta.adminNotify,"sent");
 }finally{await h.close();}
});
