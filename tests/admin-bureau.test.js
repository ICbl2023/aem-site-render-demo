import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {startHarness,form,send,candidate,attachmentsFor,png} from "./helpers.js";

const ACCOUNTS="accueil:lire-1:lecture;marie:trait-2;luc:chef-3:responsable";
async function login(h,user,password){
 const r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1"},body:JSON.stringify({user,password})});
 return {status:r.status,data:await r.json().catch(()=>null),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
}
const H=(cookie,extra={})=>({Cookie:cookie,"X-AEM-Admin":"1","Content-Type":"application/json",...extra});
async function submitted(h,answers=candidate){const id=crypto.randomUUID();const r=await send(h,form(answers,attachmentsFor(answers),id));assert.equal(r.status,200);return id;}

test("Rôles : lecture consulte seulement, traitement agit, responsable voit l’état du service",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS});
 try{
 const id=await submitted(h);
 const lecture=await login(h,"accueil","lire-1"),marie=await login(h,"marie","trait-2"),luc=await login(h,"luc","chef-3");
 assert.equal(lecture.data.role,"lecture");assert.equal(marie.data.role,"traitement");assert.equal(luc.data.role,"responsable");
 const session=await (await fetch(h.url+"/api/admin/session",{headers:{Cookie:lecture.cookie}})).json();
 assert.equal(session.role,"lecture");assert.equal(session.roles.lecture,"Lecture");
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:lecture.cookie}})).status,200,"lecture : consulter");
 for(const [method,path,body] of [["PATCH","/api/admin/dossiers/"+id,JSON.stringify({status:"in_progress"})],["POST","/api/admin/dossiers/"+id+"/request",JSON.stringify({pieces:["identity_cni_fr"]})],["DELETE","/api/admin/dossiers/"+id,undefined]]){
 const r=await fetch(h.url+path,{method,headers:H(lecture.cookie),body});
 assert.equal(r.status,403,method+" en lecture");assert.match((await r.json()).error,/lecture seule/);
 }
 assert.equal((await fetch(h.url+"/api/admin/status",{headers:{Cookie:marie.cookie}})).status,403,"état du service réservé au responsable");
 assert.equal((await fetch(h.url+"/api/admin/status",{headers:{Cookie:luc.cookie}})).status,200);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({status:"in_progress"})})).status,200,"traitement : agir");
 }finally{await h.close();}
});

test("Suivi par : attribution « moi » ou nom, retrait, historique et liste",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS,retentionDays:365});
 try{
 const id=await submitted(h);
 const marie=await login(h,"marie","trait-2");
 let r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({assignedTo:"me"})});
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.assignedTo,"marie");
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({assignedTo:"Luc"})});
 assert.equal((await r.json()).dossier.assignedTo,"Luc");
 const list=await (await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:marie.cookie}})).json();
 assert.equal(list.items[0].assignedTo,"Luc");assert.ok(list.items[0].expiresAt>list.items[0].createdAt);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({assignedTo:""})});
 const {dossier}=await r.json();
 assert.equal(dossier.assignedTo,"");
 assert.deepEqual(dossier.history.filter(e=>e.action==="assign").map(e=>e.details),["Suivi par marie","Suivi par Luc","Suivi retiré"]);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({assignedTo:"x".repeat(65)})})).status,400);
 }finally{await h.close();}
});

test("File de travail : statistiques, classés masqués par défaut, relance datée",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS});
 try{
 const a=await submitted(h),b=await submitted(h),c=crypto.randomUUID();
 const deferredAnswers={...candidate,deferred:["jdc"]};
 assert.equal((await send(h,form(deferredAnswers,attachmentsFor(deferredAnswers).filter(f=>f.key!=="jdc"),c))).status,200);
 const marie=await login(h,"marie","trait-2");
 await fetch(h.url+"/api/admin/dossiers/"+a,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({status:"archived"})});
 await fetch(h.url+"/api/admin/dossiers/"+b+"/request",{method:"POST",headers:H(marie.cookie),body:JSON.stringify({pieces:["identity_cni_fr"],message:""})});
 const stats=await (await fetch(h.url+"/api/admin/stats",{headers:{Cookie:marie.cookie}})).json();
 assert.equal(stats.total,3);assert.equal(stats.missingPieces,1);assert.equal(stats.toCollect,1);assert.equal(stats.unassigned,1);assert.equal(stats.stale,0);
 const items=async q=>(await (await fetch(h.url+"/api/admin/dossiers"+q,{headers:{Cookie:marie.cookie}})).json()).items;
 assert.deepEqual((await items("")).map(i=>i.id).sort(),[b,c].sort(),"les classés sortent de la file");
 assert.deepEqual((await items("?status=archived")).map(i=>i.id),[a]);
 assert.equal((await items("?status=all")).length,3);
 const relance=(await items("")).find(i=>i.id===b);
 assert.equal(relance.status,"missing_pieces");assert.equal(relance.staleDays,0);
 assert.equal((await items("")).find(i=>i.id===c).incomplete,true);
 }finally{await h.close();}
});

test("Dépôt au comptoir : fichier ajouté à une pièce, pièce reportée récupérée, formats refusés",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS});
 try{
 const answers={...candidate,deferred:["jdc"]};
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(answers,attachmentsFor(answers).filter(f=>f.key!=="jdc"),id))).status,200);
 const marie=await login(h,"marie","trait-2"),lecture=await login(h,"accueil","lire-1");
 const upload=async(cookie,key,files)=>{const fd=new FormData();fd.append("key",key);for(const [name,content,type] of files)fd.append("files",new Blob([content],{type}),name);return fetch(h.url+"/api/admin/dossiers/"+id+"/files",{method:"POST",headers:{Cookie:cookie,"X-AEM-Admin":"1"},body:fd});};
 assert.equal((await upload(lecture.cookie,"jdc",[["jdc.png",png,"image/png"]])).status,403);
 let r=await upload(marie.cookie,"jdc",[["jdc.png",png,"image/png"]]);
 assert.equal(r.status,200);
 const {dossier,documents}=await r.json();
 assert.equal(dossier.incomplete,false,"plus rien à récupérer");
 assert.equal(documents.find(d=>d.key==="jdc").fileCount,1);assert.equal(documents.find(d=>d.key==="jdc").deferred,false);
 const added=dossier.files.find(f=>f.key==="jdc");
 assert.equal(added.source,"comptoir");assert.equal(added.addedBy,"marie");assert.equal(added.contentType,"image/png");
 assert.ok(dossier.history.some(e=>e.action==="upload" && e.by==="marie"));
 const file=await fetch(h.url+"/api/admin/dossiers/"+id+"/files/"+added.index,{headers:{Cookie:marie.cookie}});
 assert.equal(file.status,200);assert.equal(file.headers.get("content-type"),"image/png");
 assert.equal((await upload(marie.cookie,"jdc",[["virus.exe",Buffer.from("MZ..."),"application/octet-stream"]])).status,415);
 assert.equal((await upload(marie.cookie,"inconnue",[["jdc.png",png,"image/png"]])).status,400);
 assert.equal((await upload(marie.cookie,"jdc",[])).status,400);
 }finally{await h.close();}
});

test("Fiche imprimable et mail « dossier complet » au passage en Prêt",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS,candidateMail:true});
 try{
 const id=await submitted(h);
 const marie=await login(h,"marie","trait-2");
 const page=await fetch(h.url+"/api/admin/dossiers/"+id+"/export",{headers:{Cookie:marie.cookie}});
 assert.equal(page.status,200);assert.match(page.headers.get("content-type"),/text\/html/);
 const html=await page.text();
 assert.ok(html.includes("GRAYSON Nolan") && html.includes("Pièces") && html.includes("Historique") && !html.includes("<script"));
 const before=h.messages.length;
 const r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({status:"ready"})});
 assert.equal(r.status,200);
 await new Promise(res=>setTimeout(res,300));
 const mail=h.messages.slice(before).find(m=>/complet/.test(m.subject));
 assert.ok(mail,"mail dossier complet reçu");assert.equal(mail.to.value[0].address,candidate.email);
 const {dossier}=await r.json();
 assert.ok(dossier.history.some(e=>e.action==="candidate_mail" && /dossier complet/.test(e.details)));
 // Second passage en Prêt sans changement : pas de nouveau mail.
 await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:H(marie.cookie),body:JSON.stringify({status:"ready"})});
 await new Promise(res=>setTimeout(res,200));
 assert.equal(h.messages.slice(before).filter(m=>/complet/.test(m.subject)).length,1);
 }finally{await h.close();}
});

test("Sessions conservées : un nouveau serveur sur le même dossier de données reconnaît le cookie",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:ACCOUNTS});
 let h2=null;
 try{
 const marie=await login(h,"marie","trait-2");
 await new Promise(res=>setTimeout(res,150));
 const {createApp}=await import("../server.js");
 const app=createApp({config:{origin:"http://127.0.0.1",from:"aem@example.test",recipient:"admin@example.test",receiptDir:h.dataDir+"-r",dataDir:h.dataDir,adminPassword:"",adminAccounts:ACCOUNTS,candidateMail:false}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 h2={url:"http://127.0.0.1:"+app.address().port,close:()=>new Promise(r=>app.close(r))};
 const session=await (await fetch(h2.url+"/api/admin/session",{headers:{Cookie:marie.cookie}})).json();
 assert.equal(session.authenticated,true);assert.equal(session.user,"marie");assert.equal(session.role,"traitement");
 }finally{if(h2)await h2.close();await h.close();}
});
