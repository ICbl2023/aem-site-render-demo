import test from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile,rm} from "node:fs/promises";
import {createApp,prepareCandidateMail} from "../server.js";
import {createStorage} from "../storage.js";
import {documentsFor,todayISO,ageFromDate} from "../logic.js";
import {candidate,startHarness,form,send,attachmentsFor} from "./helpers.js";

const jsonHeaders={"Content-Type":"application/json","X-AEM-Admin":"1"};
async function login(h,body={password:"test-admin"}){
 const r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:JSON.stringify(body)});
 return {status:r.status,data:await r.json(),cookie:(r.headers.get("set-cookie")||"").split(";")[0]};
}
const identityLabel=documentsFor(candidate).find(d=>d.key==="identity_cni_fr").label;
const mailTo=msg=>(msg.to?.value||[]).map(a=>a.address);

test("Comptes admin nommés : login, session avec identifiant, identifiant inconnu refusé",async()=>{
 const h=await startHarness({adminPassword:"",adminAccounts:"secretariat:s3cret-1;responsable:chef-2:responsable; invalide ;sansmdp:;mauvais:mdp:roi"});
 try{
 let l=await login(h,{user:"secretariat",password:"s3cret-1"});
 assert.equal(l.status,200);assert.equal(l.data.user,"secretariat");assert.ok(l.cookie.startsWith("aem_admin="));
 let r=await fetch(h.url+"/api/admin/session",{headers:{Cookie:l.cookie}});
 assert.deepEqual(await r.json().then(d=>[d.authenticated,d.user]),[true,"secretariat"]);
 assert.equal((await login(h,{user:"responsable",password:"chef-2"})).status,200);
 assert.equal((await login(h,{user:"responsable",password:"s3cret-1"})).status,401);
 assert.equal((await login(h,{user:"inconnu",password:"s3cret-1"})).status,401);
 assert.equal((await login(h,{user:"sansmdp",password:""})).status,401);
 assert.equal((await login(h,{password:"s3cret-1"})).status,401,"pas de compte admin implicite quand des comptes nommés existent");
 // Rôles : traitement par défaut, responsable déclaré ; l'état technique du service est réservé au responsable.
 assert.equal(l.data.role,"traitement");
 assert.equal((await fetch(h.url+"/api/admin/status",{headers:{Cookie:l.cookie}})).status,403);
 const chef=await login(h,{user:"responsable",password:"chef-2"});
 assert.equal(chef.data.role,"responsable");
 r=await fetch(h.url+"/api/admin/status",{headers:{Cookie:chef.cookie}});
 assert.equal((await r.json()).accounts,2,"l’entrée au rôle inconnu est ignorée");
 }finally{await h.close();}
});

test("Ancien mode : AEM_ADMIN_PASSWORD seule → compte unique admin, ancien corps accepté",async()=>{
 const h=await startHarness();
 try{
 let l=await login(h,{password:"test-admin"});
 assert.equal(l.status,200);assert.equal(l.data.user,"admin");
 l=await login(h,{user:"admin",password:"test-admin"});assert.equal(l.status,200);
 assert.equal((await login(h,{user:"secretariat",password:"test-admin"})).status,401);
 const r=await fetch(h.url+"/api/admin/session",{headers:{Cookie:l.cookie}});
 assert.equal((await r.json()).user,"admin");
 assert.equal((await fetch(h.url+"/api/admin/session")).status,200);
 assert.equal((await (await fetch(h.url+"/api/admin/session")).json()).authenticated,false);
 }finally{await h.close();}
});

test("Accusé de réception candidat : mail reçu par le SMTP labo, état tracé dans le dossier",async()=>{
 const h=await startHarness({candidateMail:true});
 try{
 const id=crypto.randomUUID();
 const r=await send(h,form(candidate,attachmentsFor(candidate),id));assert.equal(r.status,200);
 assert.equal(h.messages.length,2);
 const ack=h.messages.find(m=>mailTo(m).includes("nolan@example.test"));
 assert.ok(ack,"un mail au candidat est présent dans h.messages");
 assert.equal(ack.subject,"AEM — votre dossier ANTS est bien reçu (réf. "+id.slice(0,8)+")");
 for(const part of ["Bonjour Nolan,","Pièces reçues :","- "+identityLabel+"\n","Référence complète : "+id,"AEM vérifie votre dossier","Aucune action n’est attendue de votre part pour le moment.","Auto-école Majolane","46 rue de la République, 69330 Meyzieu","04 78 31 79 85","aem69330@gmail.com"])assert.ok(ack.text.includes(part),"contenu attendu : "+part);
 assert.ok(!ack.text.includes("Pièces manquantes"));
 assert.ok(!ack.text.includes("identity-cni-fr-0.pdf"),"aucun nom de fichier dans l’accusé");
 assert.equal(ack.to.value[0].name,"Nolan","prénom seul dans le destinataire");
 assert.ok(h.messages.some(m=>mailTo(m).includes("admin@example.test")),"la notification AEM est conservée");
 const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
 assert.equal(meta.candidateMail,"sent");
 assert.deepEqual(meta.history.map(e=>e.action),["received","candidate_mail"]);
 assert.equal(meta.history[0].by,"système");
 }finally{await h.close();}
});

test("Accusé candidat : pièces différées listées, échec du mail sans échec de la soumission",async()=>{
 const deferredAnswers={...candidate,workflow:"permis",medical:"oui",deferred:["medical"]};
 const uploads=attachmentsFor(deferredAnswers).filter(f=>f.key!=="medical");
 const mail=prepareCandidateMail({answers:deferredAnswers,uploads,submissionId:crypto.randomUUID()},{from:"aem@example.test",recipient:"admin@example.test"});
 assert.deepEqual(mail.to,{address:"nolan@example.test",name:"Nolan"});assert.equal(mail.replyTo,"admin@example.test");
 assert.ok(mail.subject.startsWith("AEM — votre dossier Permis est bien reçu"));
 assert.ok(mail.text.includes("Pièces à fournir, AEM vous recontactera :\n- Avis médical"));
 assert.ok(!mail.text.includes("Pièces manquantes"));
 assert.ok(mail.text.includes("Prochaines étapes : préparez les pièces listées ci-dessus ; AEM vous recontactera pour convenir de leur transmission (réponse à cet e-mail ou dépôt à l’auto-école) et vérifie le reste du dossier."));
 assert.ok(!mail.text.includes("Aucune action n’est attendue"));
 assert.ok(!mail.text.includes(".pdf"),"seuls les libellés des pièces sont cités");
 // Le permis n'est jamais différable : un report déclaré est ignoré et la pièce reste « manquante » (le serveur refuse d'ailleurs l'envoi).
 const strict=prepareCandidateMail({answers:{...candidate,workflow:"permis",deferred:["permit_current"]},uploads:attachmentsFor(candidate),submissionId:crypto.randomUUID()},{from:"aem@example.test"});
 assert.ok(strict.text.includes("Pièces manquantes :\n- Permis de conduire actuel"));assert.ok(!strict.text.includes("Pièces à fournir"));
 assert.ok(strict.text.includes("Aucune action n’est attendue"));
 const dataDir="test-results/ack-"+crypto.randomUUID();
 const transport={sent:[],async sendMail(m){if(m.to?.address==="nolan@example.test")throw new Error("candidate SMTP failure");this.sent.push(m);return {accepted:[m.to]};}};
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir:"test-results/ack-r-"+crypto.randomUUID(),dataDir,candidateMail:true},transport});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));const h={url:"http://127.0.0.1:"+app.address().port,origin:"http://test"},id=crypto.randomUUID();
 try{
 const r=await send(h,form(candidate,attachmentsFor(candidate),id));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 assert.equal(transport.sent.length,1);
 const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
 assert.equal(meta.candidateMail,"failed");
 assert.ok(meta.history.some(e=>e.action==="candidate_mail" && e.details.includes("Échec")));
 }finally{await new Promise(r=>app.close(r));}
});

test("Demande de pièce : validation, mail candidat, statut missing_pieces, historique",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const {cookie}=await login(h);
 const headers={...jsonHeaders,Cookie:cookie};
 const post=(target,body)=>fetch(h.url+"/api/admin/dossiers/"+target+"/request",{method:"POST",headers,body:JSON.stringify(body)});
 assert.equal((await post(crypto.randomUUID(),{pieces:["identity_cni_fr"]})).status,404);
 assert.equal((await post(id,{pieces:["medical"],message:""})).status,400,"clé hors dossier refusée");
 assert.equal((await post(id,{pieces:[],message:"x"})).status,400);
 assert.equal((await post(id,{pieces:["identity_cni_fr"],message:"a".repeat(2001)})).status,400);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:jsonHeaders,body:JSON.stringify({pieces:["jdc"]})})).status,401,"sans cookie valide : refus");
 const before=h.messages.length;
 let r=await post(id,{pieces:["identity_cni_fr","jdc","identity_cni_fr"],message:"Le recto de votre CNI est illisible."});
 assert.equal(r.status,200);
 const {dossier}=await r.json();
 assert.equal(dossier.status,"missing_pieces");
 assert.deepEqual(dossier.history.map(e=>e.action),["received","request","status"]);
 assert.equal(dossier.history[1].by,"admin");
 assert.ok(dossier.history[1].details.includes(identityLabel) && dossier.history[1].details.includes("Le recto"));
 assert.equal(h.messages.length,before+1);
 const mail=h.messages.at(-1);
 assert.deepEqual(mailTo(mail),["nolan@example.test"]);
 assert.equal(mail.subject,"AEM — pièces à fournir pour votre dossier (réf. "+id.slice(0,8)+")");
 for(const part of ["Bonjour Nolan,","- "+identityLabel,"- JDC ou avis de situation","Message d’AEM :\nLe recto de votre CNI est illisible.","Référence complète : "+id,"04 78 31 79 85"])assert.ok(mail.text.includes(part),"contenu attendu : "+part);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}});
 const detail=await r.json();
 assert.equal(detail.dossier.status,"missing_pieces");assert.equal(detail.dossier.history.length,3);
 assert.ok(detail.documents.some(d=>d.key==="identity_cni_fr" && d.fileCount===1));
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers,body:JSON.stringify({status:"in_progress",adminNote:"Relance faite"})});
 const patched=(await r.json()).dossier;
 assert.deepEqual(patched.history.slice(3).map(e=>[e.by,e.action]),[["admin","status"],["admin","note"]]);
 }finally{await h.close();}
});

test("Accusé candidat : plafond de 3 accusés par adresse (normalisée) et par 24 h",async()=>{
 const h=await startHarness({candidateMail:true});
 try{
 const ids=[];
 for(let i=0;i<4;i++){
 const id=crypto.randomUUID();ids.push(id);
 assert.equal((await send(h,form({...candidate,email:i%2?"Nolan@Example.test":"nolan@example.test"},attachmentsFor(candidate),id))).status,200);
 }
 const metas=await Promise.all(ids.map(id=>readFile(h.dataDir+"/"+id+"/meta.json","utf8").then(JSON.parse)));
 assert.deepEqual(metas.map(m=>m.candidateMail),["sent","sent","sent","skipped"]);
 assert.ok(metas[3].history.some(e=>e.action==="candidate_mail" && e.details.includes("plafond atteint")));
 assert.equal(h.messages.filter(m=>mailTo(m).some(a=>a.toLowerCase()==="nolan@example.test")).length,3);
 assert.equal(h.messages.length,7,"4 notifications AEM + 3 accusés");
 }finally{await h.close();}
});

test("Pièces différées visibles côté admin : liste (incomplete), fiche (documents.deferred), historique",async()=>{
 const h=await startHarness();
 try{
 const a={...candidate,deferred:["jdc","hosting"]};
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(a,attachmentsFor(candidate).filter(f=>!a.deferred.includes(f.key)),id))).status,200);
 const {cookie}=await login(h);
 const list=await (await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie}})).json();
 assert.equal(list.items.find(i=>i.id===id).incomplete,true);
 const detail=await (await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).json();
 assert.equal(detail.dossier.incomplete,true);
 assert.ok(detail.dossier.history[0].details.includes("2 pièce(s) à récupérer"));
 const byKey=Object.fromEntries(detail.documents.map(d=>[d.key,d]));
 assert.deepEqual([byKey.jdc.deferred,byKey.jdc.fileCount,byKey.hosting.deferred,byKey.identity_cni_fr.deferred,byKey.identity_cni_fr.fileCount],[true,0,true,false,1]);
 assert.ok(h.messages[0].text.includes("Pièces à récupérer : JDC ou avis de situation, Attestation d’hébergement datée d’aujourd’hui"));
 const complete=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),complete))).status,200);
 const full=await (await fetch(h.url+"/api/admin/dossiers/"+complete,{headers:{Cookie:cookie}})).json();
 assert.equal(full.dossier.incomplete,false);assert.ok(full.documents.every(d=>d.deferred===false));
 assert.ok(!h.messages.at(-1).text.includes("Pièces à récupérer"));
 }finally{await h.close();}
});

test("Documents du dossier figés à la date de réception (âge qui bascule le lendemain)",async()=>{
 const h=await startHarness();
 try{
 const today=todayISO(),suffix=today.slice(5)==="02-29"?"02-28":today.slice(5);
 const a={...candidate,birthDate:String(Number(today.slice(0,4))-25).padStart(4,"0")+"-"+suffix}; // 25 ans aujourd'hui : plus de JDC
 assert.equal(ageFromDate(a.birthDate),25);assert.ok(!documentsFor(a).some(d=>d.key==="jdc"));
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(a,attachmentsFor(a),id))).status,200);
 const metaPath=h.dataDir+"/"+id+"/meta.json",meta=JSON.parse(await readFile(metaPath,"utf8"));
 meta.createdAt=new Date(Date.now()-86400000).toISOString(); // reçu la veille, à 24 ans : la JDC faisait partie du dossier
 await writeFile(metaPath,JSON.stringify(meta));
 const {cookie}=await login(h);
 const detail=await (await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).json();
 const jdc=detail.documents.find(d=>d.key==="jdc");
 assert.ok(jdc && jdc.fileCount===0 && jdc.deferred===false,"la JDC reste listée telle qu'attendue à la réception");
 const r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({pieces:["jdc"]})});
 assert.equal(r.status,200);assert.ok(h.messages.at(-1).text.includes("- JDC ou avis de situation"));
 }finally{await h.close();}
});

test("Demande de pièce : 409 si une demande date de moins de 60 s, note longue acceptée",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const {cookie}=await login(h);
 const post=body=>fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify(body)});
 assert.equal((await post({pieces:["jdc"]})).status,200);
 let r=await post({pieces:["jdc"]});
 assert.equal(r.status,409);assert.equal((await r.json()).error,"Une demande vient d’être envoyée pour ce dossier.");
 assert.equal(h.messages.length,2,"aucun second mail");
 const metaPath=h.dataDir+"/"+id+"/meta.json",meta=JSON.parse(await readFile(metaPath,"utf8"));
 meta.history.find(e=>e.action==="request").at=new Date(Date.now()-61000).toISOString();
 await writeFile(metaPath,JSON.stringify(meta));
 assert.equal((await post({pieces:["jdc"],message:"é".repeat(2000)})).status,200,"demande ancienne : nouvelle demande acceptée, message accentué de 2000 caractères");
 const note="’é".repeat(2000); // 4000 caractères, 10 000 octets UTF-8 : dépassait l'ancienne limite de 8 Ko
 assert.ok(Buffer.byteLength(JSON.stringify({adminNote:note}))>8192);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({adminNote:note})});
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.adminNote,note);
 }finally{await h.close();}
});

test("Demande de pièce : 502 si le mail échoue (statut inchangé), 503 sans messagerie",async()=>{
 const suffix=crypto.randomUUID(),dataDir="test-results/req-"+suffix;
 const transport={async sendMail(m){if(m.subject.startsWith("AEM — pièces"))throw new Error("SMTP down");return {accepted:[m.to]};}};
 let app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir:"test-results/req-r-"+suffix,dataDir,adminPassword:"test-admin",candidateMail:false},transport});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 let h={url:"http://127.0.0.1:"+app.address().port,origin:"http://test"};
 const id=crypto.randomUUID();
 try{
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const {cookie}=await login(h);
 const r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({pieces:["identity_cni_fr"]})});
 assert.equal(r.status,502);
 const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
 assert.equal(meta.status,"received");assert.equal(meta.history.length,1);
 }finally{await new Promise(r=>app.close(r));}
 app=createApp({config:{origin:"http://test",smtpHost:"",from:"",recipient:"",receiptDir:"test-results/req-r2-"+suffix,dataDir,adminPassword:"test-admin"}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 h={url:"http://127.0.0.1:"+app.address().port,origin:"http://test"};
 try{
 const {cookie}=await login(h);
 const r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({pieces:["identity_cni_fr"]})});
 assert.equal(r.status,503);assert.ok((await r.json()).error.includes("Messagerie non configurée"));
 const status=await (await fetch(h.url+"/api/admin/status",{headers:{Cookie:cookie}})).json();
 assert.equal(status.mail,false);
 }finally{await new Promise(r=>app.close(r));}
});

test("CSRF admin : refus des requêtes mutantes sans en-tête X-AEM-Admin",async()=>{
 const h=await startHarness();
 try{
 const plain=body=>({method:"POST",headers:{"Content-Type":"text/plain"},body});
 let r=await fetch(h.url+"/api/admin/login",plain(JSON.stringify({password:"test-admin"})));
 assert.equal(r.status,403);assert.ok((await r.json()).error.includes("X-AEM-Admin"));
 const {cookie}=await login(h);
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"text/plain"},body:JSON.stringify({status:"in_progress"})});
 assert.equal(r.status,403);
 r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{Cookie:cookie,"Content-Type":"text/plain"},body:JSON.stringify({pieces:["identity_cni_fr"]})});
 assert.equal(r.status,403);
 r=await fetch(h.url+"/api/admin/logout",{method:"POST",headers:{Cookie:cookie,"Content-Type":"text/plain"}});
 assert.equal(r.status,403);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"text/plain","X-AEM-Admin":"1"},body:JSON.stringify({status:"in_progress"})});
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.status,"in_progress");
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).status,200,"les GET restent accessibles");
 const ok=(await fetch(h.url+"/api/admin/logout",{method:"POST",headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status;
 assert.equal(ok,200);
 assert.equal((await fetch(h.url+"/api/admin/stats",{headers:{Cookie:cookie}})).status,401);
 }finally{await h.close();}
});

test("État du service : /api/admin/status authentifié",async()=>{
 const h=await startHarness({aiEnabled:true,retentionDays:90});
 try{
 assert.equal((await fetch(h.url+"/api/admin/status")).status,401);
 const {cookie}=await login(h);
 const status=await (await fetch(h.url+"/api/admin/status",{headers:{Cookie:cookie}})).json();
 assert.equal(status.mail,true);assert.equal(status.ai,true);assert.equal(status.retentionDays,90);
 assert.equal(status.accounts,1);assert.equal(status.dataDir,"configuré");assert.equal(status.user,"admin");
 assert.equal(status.candidateMail,false);
 }finally{await h.close();}
});

test("Robustesse : cookie admin illisible vaut « non connecté », le serveur répond toujours (serveur-1)",async()=>{
 const h=await startHarness();
 try{
 let r=await fetch(h.url+"/api/admin/session",{headers:{Cookie:"aem_admin=%E0"}});
 assert.equal(r.status,200);assert.equal((await r.json()).authenticated,false);
 r=await fetch(h.url+"/api/admin/stats",{headers:{Cookie:"autre=%ZZ; aem_admin=%E0%"}});
 assert.equal(r.status,401);
 assert.equal((await fetch(h.url+"/api/config")).status,200,"le processus répond encore");
 const {cookie}=await login(h);
 assert.equal((await (await fetch(h.url+"/api/admin/session",{headers:{Cookie:cookie}})).json()).authenticated,true);
 }finally{await h.close();}
});

test("Robustesse : meta.json corrompu et fichier parasite ignorés, fichier supprimé → 404, serveur toujours vivant (admin-1)",async()=>{
 const h=await startHarness();
 try{
 const {cookie}=await login(h);
 const ok=crypto.randomUUID(),bad=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),ok))).status,200);
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),bad))).status,200);
 await writeFile(h.dataDir+"/"+bad+"/meta.json","{corrompu");
 await writeFile(h.dataDir+"/fichier-parasite.txt","x");
 await rm(h.dataDir+"/index.json");
 let r=await fetch(h.url+"/api/admin/dossiers/"+bad,{headers:{Cookie:cookie}});
 assert.equal(r.status,404);assert.equal((await r.json()).error,"Dossier introuvable.");
 r=await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie}});
 assert.equal(r.status,200);assert.deepEqual((await r.json()).items.map(i=>i.id),[ok],"dossier corrompu et fichier parasite absents de la liste");
 r=await fetch(h.url+"/api/admin/stats",{headers:{Cookie:cookie}});
 assert.equal(r.status,200);assert.equal((await r.json()).total,1);
 const meta=JSON.parse(await readFile(h.dataDir+"/"+ok+"/meta.json","utf8"));
 await rm(h.dataDir+"/"+ok+"/files/"+meta.files[0].storedAs);
 r=await fetch(h.url+"/api/admin/dossiers/"+ok+"/files/0",{headers:{Cookie:cookie}});
 assert.equal(r.status,404);assert.equal((await r.json()).error,"Fichier introuvable.");
 assert.equal((await fetch(h.url+"/api/config")).status,200,"le processus répond encore");
 }finally{await h.close();}
});

test("Robustesse : exception imprévue d’une route → 500 « Erreur interne. » journalisée, sans arrêt du serveur (admin-1)",async()=>{
 const suffix=crypto.randomUUID(),dataDir="test-results/robust-"+suffix;
 const storage=createStorage(dataDir);
 const app=createApp({config:{origin:"http://test",receiptDir:"test-results/robust-r-"+suffix,dataDir,adminPassword:"test-admin"},storage:{...storage,async list(){throw new Error("disque indisponible (test)");}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));
 const h={url:"http://127.0.0.1:"+app.address().port,origin:"http://test"};
 try{
 const {cookie}=await login(h);
 const r=await fetch(h.url+"/api/admin/stats",{headers:{Cookie:cookie}});
 assert.equal(r.status,500);assert.deepEqual(await r.json(),{error:"Erreur interne."});
 assert.equal((await fetch(h.url+"/api/admin/status",{headers:{Cookie:cookie}})).status,200,"le serveur répond encore");
 }finally{await new Promise(r=>app.close(r));}
});

test("Corps JSON illisible : 400 avec message contrôlé sur login, PATCH et demande de pièce ; 413 inchangé (admin-5, serveur-2)",async()=>{
 const h=await startHarness();
 try{
 let r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:"{oops"});
 assert.equal(r.status,400);assert.deepEqual(await r.json(),{error:"Corps de requête illisible."});
 const {cookie}=await login(h);
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{...jsonHeaders,Cookie:cookie},body:"{oops"});
 assert.equal(r.status,400);assert.equal((await r.json()).error,"Corps de requête illisible.");
 r=await fetch(h.url+"/api/admin/dossiers/"+id+"/request",{method:"POST",headers:{...jsonHeaders,Cookie:cookie},body:"pas du json"});
 assert.equal(r.status,400);assert.equal((await r.json()).error,"Corps de requête illisible.");
 r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:jsonHeaders,body:"x".repeat(9000)});
 assert.equal(r.status,413,"le 413 de readBody se propage inchangé");
 assert.equal((await login(h)).status,200,"un corps valide fonctionne toujours");
 }finally{await h.close();}
});

test("Limite /api/submit : les envois acceptés sont recrédités, seuls les échecs consomment le quota (questionnaires-9)",async()=>{
 const h=await startHarness();
 try{
 for(let i=0;i<21;i++)assert.equal((await send(h,form(candidate,attachmentsFor(candidate)))).status,200,"envoi valide n° "+(i+1)+" : jamais de 429");
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200,"renvoi idempotent recrédité aussi");
 const invalid=()=>send(h,form({...candidate,email:"pas-un-mail"},attachmentsFor(candidate)));
 for(let i=0;i<20;i++)assert.equal((await invalid()).status,422);
 assert.equal((await invalid()).status,429,"21e échec : quota consommé");
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate)))).status,429,"un envoi valide est bloqué aussi tant que la fenêtre court");
 }finally{await h.close();}
});

test("Limitation par identifiant connu en plus de l’IP : 10 échecs bloquent ce compte seul, identifiant inconnu sans compteur (admin-15)",async()=>{
 const h=await startHarness({trustProxy:true,adminPassword:"",adminAccounts:"secretariat:s3cret-1;responsable:chef-2"});
 try{
 const attempt=(user,password,ip)=>fetch(h.url+"/api/admin/login",{method:"POST",headers:{...jsonHeaders,"X-Forwarded-For":ip},body:JSON.stringify({user,password})}).then(r=>r.status);
 for(let i=0;i<10;i++)assert.equal(await attempt("secretariat","wrong","198.51.100."+i),401,"IP différentes : la limite par IP (5) n’intervient pas");
 assert.equal(await attempt("secretariat","s3cret-1","203.0.113.50"),429,"compte bloqué même depuis une IP neuve et avec le bon mot de passe");
 assert.equal(await attempt("responsable","chef-2","203.0.113.50"),200,"autre compte, même IP : accessible");
 for(let i=0;i<10;i++)assert.equal(await attempt("inconnu","wrong","198.51.100."+(20+i)),401);
 assert.equal(await attempt("inconnu","wrong","203.0.113.51"),401,"identifiant inconnu : pas de compteur propre, toujours 401");
 }finally{await h.close();}
});

test("Note interne : caractères de contrôle refusés, 4001 caractères refusés sans troncature, 4000 acceptés, multiligne conservée (admin-16)",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const {cookie}=await login(h);
 const patch=adminNote=>fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({adminNote})});
 let r=await patch("a"+String.fromCharCode(0)+"b");
 assert.equal(r.status,400);assert.equal((await r.json()).error,"Note invalide.");
 assert.equal((await patch("a"+String.fromCharCode(27)+"b")).status,400);
 assert.equal((await patch("a"+String.fromCharCode(127)+"b")).status,400);
 r=await patch("a".repeat(4001));
 assert.equal(r.status,400);assert.equal((await r.json()).error,"Note trop longue (4000 caractères maximum).");
 r=await patch("a".repeat(4000));
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.adminNote.length,4000);
 const multi="Ligne 1"+String.fromCharCode(10)+"Ligne 2"+String.fromCharCode(9)+"avec tabulation";
 r=await patch(multi);
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.adminNote,multi);
 }finally{await h.close();}
});

test("Fiche avec workflowLabel, session avec historyActions, « reçus aujourd’hui » en jour civil Europe/Paris (admin-14, admin-4)",async()=>{
 const h=await startHarness();
 try{
 const {cookie}=await login(h);
 const session=await (await fetch(h.url+"/api/admin/session",{headers:{Cookie:cookie}})).json();
 assert.equal(session.historyActions.request,"Demande de pièce");
 const a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID();
 for(const id of [a,b,c])assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const detail=await (await fetch(h.url+"/api/admin/dossiers/"+a,{headers:{Cookie:cookie}})).json();
 assert.equal(detail.dossier.workflowLabel,"ANTS");
 let r=await fetch(h.url+"/api/admin/dossiers/"+a,{method:"PATCH",headers:{...jsonHeaders,Cookie:cookie},body:JSON.stringify({status:"in_progress"})});
 assert.equal((await r.json()).dossier.workflowLabel,"ANTS");
 // b : reçu à 00:30 heure de Paris aujourd’hui (la veille en UTC) ; c : sans date, ne doit pas faire planter la route.
 const paris={timeZone:"Europe/Paris"};
 const today=new Intl.DateTimeFormat("fr-CA",{...paris,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 const offset=new Intl.DateTimeFormat("en-US",{...paris,timeZoneName:"longOffset"}).formatToParts(new Date()).find(p=>p.type==="timeZoneName").value.replace("GMT","")||"+00:00";
 const setCreated=async(id,value)=>{const p=h.dataDir+"/"+id+"/meta.json",m=JSON.parse(await readFile(p,"utf8"));if(value===null)delete m.createdAt;else m.createdAt=value;await writeFile(p,JSON.stringify(m));};
 await setCreated(b,new Date(today+"T00:30:00"+offset).toISOString());
 await setCreated(c,null);
 await rm(h.dataDir+"/index.json");
 r=await fetch(h.url+"/api/admin/stats",{headers:{Cookie:cookie}});
 assert.equal(r.status,200);
 const stats=await r.json();
 assert.equal(stats.total,3);assert.equal(stats.today,2,"a (maintenant) et b (00:30 Paris) comptés, c sans date ignoré");
 }finally{await h.close();}
});

test("Admin : suppression définitive d’un dossier (droit à l’effacement), reçu compris",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 const {cookie}=await login(h);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{method:"DELETE"})).status,403,"sans en-tête anti-CSRF : refusé");
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{method:"DELETE",headers:{"X-AEM-Admin":"1"}})).status,401,"sans session : refusé");
 let r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"DELETE",headers:{Cookie:cookie,"X-AEM-Admin":"1"}});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{headers:{Cookie:cookie}})).status,404,"le dossier n’existe plus");
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+id,{method:"DELETE",headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,404);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/not-a-uuid",{method:"DELETE",headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).status,404);
 }finally{await h.close();}
});
