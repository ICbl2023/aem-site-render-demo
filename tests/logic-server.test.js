import test from "node:test";
import assert from "node:assert/strict";
import {newSubmissionId,ageFromDate,ageDocuments,dateParts,expiryStatus,stepsFor,documentsFor,cleanAnswers,answerErrors,auditText,subjectFor,documentAge,fieldError,monthAge,missingRequiredDocuments,maskDate,dateFromInput,dateInputValue,limits} from "../logic.js";
import {createApp,detectedType} from "../server.js";
import {deferredDocuments} from "../logic.js";
import {createStorage} from "../storage.js";
import {candidate,png,pdf,heic,startHarness,form,send,attachmentsFor} from "./helpers.js";
const now=new Date("2026-09-08T12:00:00Z");
for(const nationality of ["francaise","etrangere"])for(const age of [15,16,17,18,21,24,25,26]){
 test(age+" ans "+nationality,()=>{
 const a={...candidate,nationality,birthDate:(2026-age)+"-09-08"};
 assert.equal(ageFromDate(a.birthDate,now),age);
 const expected=age===15?["assr_15"]:age<=21?["assr_2"]:[];
 if(nationality==="francaise"&&age===17)expected.push("recensement");
 if(nationality==="francaise"&&age>=17&&age<25)expected.push("jdc");
 assert.deepEqual(ageDocuments(a,now).map(d=>d.key),expected);
 });
}
test("JDC : bornes françaises 16 / 17 / 24 / 25 (ANTS et Permis)",()=>{
 for(const workflow of ["ants","permis"]){
 for(const [age,want] of [[16,false],[17,true],[18,true],[24,true],[25,false],[26,false]]){
  const a={...candidate,workflow,nationality:"francaise",birthDate:(2026-age)+"-09-08"};
  assert.equal(documentsFor(a,now).some(d=>d.key==="jdc"),want,"FR "+age+" ans → JDC="+want);
  assert.equal(documentsFor({...a,nationality:"etrangere"},now).some(d=>d.key==="jdc"),false,"étranger "+age+" ans → pas de JDC");
 }
 }
});
test("Dates impossibles, futures, bissextiles et anniversaires",()=>{
 for(const d of ["","nonsense","2025-02-29","2026-13-01","2026-04-31","0000-01-01"])assert.equal(dateParts(d),null);
 assert.equal(ageFromDate("2027-01-01",now),null);assert.equal(ageFromDate("2008-09-09",now),17);
 assert.equal(ageFromDate("2008-09-08",now),18);assert.ok(dateParts("2024-02-29"));
});
test("Expiration robuste et durée calendaire",()=>{
 assert.equal(expiryStatus("",now).status,"À vérifier");assert.equal(expiryStatus("xxx",now).status,"À vérifier");
 assert.equal(expiryStatus("2026-02-31",now).status,"À vérifier");
 assert.equal(expiryStatus("2026-09-07",now).status,"Expiré");
 assert.equal(expiryStatus("2026-09-08",now).detail,"Expire aujourd’hui");
 assert.equal(expiryStatus("2030-05-12",now).detail,"Validité restante : 3 ans et 8 mois et 4 jours");
 assert.equal(expiryStatus("2027-02-28",new Date("2027-01-31T12:00:00Z")).detail,"Validité restante : 1 mois");
});
test("Coordonnées candidat toujours présentes, proche uniquement mineur",()=>{
 for(const workflow of ["ants","permis"]){
 for(const [birthDate,minor] of [["2008-03-12",false],["2009-03-12",true],["",false]]){
 const a={...candidate,workflow,birthDate,contactName:"Debbie Exemple",contactPhone:"0600000001",contactEmail:"debbie@example.test"};
 const fields=stepsFor(a).flatMap(s=>s.fields.map(f=>f.key));
 assert.ok(fields.includes("phone")&&fields.includes("email"));
 assert.equal(fields.includes("contactName"),minor);
 assert.equal(Object.hasOwn(cleanAnswers(a),"contactName"),minor);
 assert.equal(auditText(a,[],now).includes("PERSONNE À CONTACTER"),minor);
 assert.equal(auditText(a,[],now).includes("Debbie Exemple"),minor);
 }
 }
});
test("Validation serveur et nettoyage des branches",()=>{
 assert.ok(answerErrors({...candidate,birthName:""}).length);assert.ok(answerErrors({...candidate,firstName:""}).length);
 assert.ok(answerErrors({...candidate,email:"bad"}).length);
 const a=cleanAnswers({...candidate,unexpectedField:"stale",birthCity:"forbidden",nationality:"etrangere"});
 assert.equal(a.birthCity,undefined);assert.equal(a.unexpectedField,undefined);assert.equal(a.identityDocument,undefined);
 assert.ok(answerErrors(a).some(e=>e.field==="identityDocument"));
 const child=stepsFor({...candidate,birthDate:"2010-01-01"});assert.ok(child.some(s=>s.id==="coordinates"));assert.ok(child.some(s=>s.id==="contact"));
});
test("ANTS et permis : branches spécifiques et absence de nouvelles obligations",()=>{
 const ants={...candidate,workflow:"ants",special:"oui",specialReason:"medical"};
 assert.ok(documentsFor(ants).some(d=>d.key==="special_medical"));assert.ok(stepsFor(ants).some(s=>s.id==="identityFiles"));
 const permit={...ants,workflow:"permis",medical:"oui"};
 assert.ok(!documentsFor(permit).some(d=>d.key==="permit_current" || d.key==="permit_cepc"));
 assert.ok(documentsFor(permit).some(d=>d.key==="medical"));
 assert.ok(documentsFor(permit).some(d=>d.group==="age"));
 assert.ok(!stepsFor(permit).some(s=>s.id==="emancipation" || s.id==="permitType" || s.id==="permitFiles"));
});
test("Audit intégral, ordre du nom, pièces manquantes ≠ conformité",()=>{
 const text=auditText(candidate,[{key:"identity_cni_fr",name:"IMG_4827.HEIC"},{key:"identity_cni_fr",name:"IMG_4828.HEIC"}],now);
 for(const title of ["IDENTITÉ","PIÈCE","DOCUMENTS LIÉS","COORDONNÉES","DOMICILE","DOCUMENTS TRANSMIS"])assert.ok(text.includes(title));
 assert.ok(text.includes("12/03/2006 (20 ans)"));assert.ok(text.includes("IMG_4827.HEIC"));assert.ok(text.includes("Aucun fichier transmis"));
 assert.ok(!text.includes("CI1"));assert.equal(subjectFor(candidate),"Dossier ANTS – GRAYSON Nolan");
 assert.doesNotThrow(()=>auditText({...candidate,identityExpiry:"oops"},[],now));
});
test("Signatures et formats",()=>{
 assert.equal(detectedType(png,"image.png"),"image/png");assert.equal(detectedType(pdf,"test.pdf"),"application/pdf");
 assert.equal(detectedType(heic,"IMG_4827.HEIC"),"image/heic");assert.equal(detectedType(heic,"IMG_4827.HEIF"),"image/heif");
 assert.equal(detectedType(Buffer.from([255,216,255,224]),"photo.jpg"),"image/jpeg");
 assert.equal(detectedType(Buffer.from([255,216,255,224]),"photo.jpeg"),"image/jpeg");
 assert.equal(detectedType(Buffer.from("<script>"),"photo.png"),null);
});
test("Transmission HTTP → stockage + notification, reprise sans doublon",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 const attachments=attachmentsFor(candidate);
 attachments[0]={key:"identity_cni_fr",name:"IMG_4827.HEIC",content:heic};
 attachments.splice(1,0,{key:"identity_cni_fr",name:"recto été.png",content:png});
 let r=await send(h,form(candidate,attachments,id));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 assert.equal(h.messages.length,1);const msg=h.messages[0];
 assert.match(msg.subject,/a soumis son questionnaire|Nouveau dossier/);assert.ok(msg.text.includes("nolan@example.test"));
 assert.ok(!/Pièces à récupérer|restent à récupérer/.test(msg.text) || msg.text.includes("Aucune pièce"),"aucune pièce différée bloquante dans le mail");
 const {readFile}=await import("node:fs/promises");
 const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
 assert.equal(meta.files.length,attachments.length);
 r=await send(h,form(candidate,attachments,id));assert.equal(r.status,200);assert.equal(h.messages.length,1);
 r=await send(h,form({...candidate,firstName:"Mark"},attachments,id));assert.equal(r.status,409);
 }finally{await h.close();}
});
test("Refus HTTP : origine, données, contenu, fichiers hors branche, taille",async()=>{
 const h=await startHarness({limits:{fileBytes:1000,totalBytes:500000,fileCount:30}});
 try{
 assert.equal((await send(h,form(),"https://evil.example")).status,403);
 assert.equal((await send(h,form({...candidate,email:"not-mail"}))).status,422);
 const bad=attachmentsFor(candidate);bad[0]={key:"identity_cni_fr",name:"evil.png",content:Buffer.from("not png")};
 assert.equal((await send(h,form(candidate,bad))).status,415);
 assert.equal((await send(h,form(candidate,[{key:"medical",name:"avis.pdf",content:pdf}]))).status,400);
 const huge=attachmentsFor(candidate);huge[0]={key:"identity_cni_fr",name:"huge.pdf",content:Buffer.concat([pdf,Buffer.alloc(1500)])};
 assert.equal((await send(h,form(candidate,huge))).status,413);
 assert.equal(h.messages.length,0);
 }finally{await h.close();}
});
test("Les fichiers serveur, configurations, sauvegardes et reçus ne sont jamais servis",async()=>{
 const h=await startHarness();
 try{for(const file of ["server-config.js","draft-storage.js","storage.js","admin-auth.js",".env","backup/index.html","package.json",".runtime/test.json","INSCRIPTION%20v1.xmind"])assert.equal((await fetch(h.url+"/"+file)).status,404,file);}
 finally{await h.close();}
});
test("Pas de faux succès si SMTP absent",async()=>{
 const app=createApp({config:{smtpHost:"",from:"",origin:""}});await new Promise(r=>app.listen(0,"127.0.0.1",r));
 try{const r=await fetch("http://127.0.0.1:"+app.address().port+"/api/submit",{method:"POST",body:form()});assert.equal(r.status,503);}
 finally{await new Promise(r=>app.close(r));}
});
test("Échec SMTP : dossier stocké, soumission 200, adminNotify failed, reprise sans doublon",async()=>{
 const dataDir="test-results/failure-"+crypto.randomUUID();
 const app=createApp({config:{origin:"http://test",from:"aem@example.test",recipient:"admin@example.test",receiptDir:"test-results/failure-r-"+crypto.randomUUID(),dataDir},transport:{async sendMail(){throw new Error("SMTP failure");}}});
 await new Promise(r=>app.listen(0,"127.0.0.1",r));const h={url:"http://127.0.0.1:"+app.address().port,origin:"http://test"},id=crypto.randomUUID();
 try{
 let r=await send(h,form(candidate,attachmentsFor(candidate),id));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 const {readFile}=await import("node:fs/promises");
 const meta=JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8"));
 assert.equal(meta.adminNotify,"failed");
 r=await send(h,form(candidate,attachmentsFor(candidate),id));assert.equal(r.status,200);
 assert.equal(JSON.parse(await readFile(dataDir+"/"+id+"/meta.json","utf8")).adminNotify,"failed","pas de nouveau dossier ni renvoi auto");
 }finally{await new Promise(r=>app.close(r));}
});
test("Sécurité admin : UUID invalide et patch restreint",async()=>{
 const h=await startHarness();
 try{
 let r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:"test-admin"})});
 const cookie=r.headers.get("set-cookie").split(";")[0];
 assert.equal((await fetch(h.url+"/api/admin/dossiers/not-a-uuid",{headers:{Cookie:cookie}})).status,404);
 r=await fetch(h.url+"/api/admin/dossiers/"+crypto.randomUUID(),{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify({status:"in_progress",extra:"hack"})});
 assert.equal(r.status,404);
 assert.equal((await fetch(h.url+"/api/admin/dossiers/"+crypto.randomUUID(),{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify({answers:{workflow:"permis"}})})).status,400);
 }finally{await h.close();}
});
test("Sécurité admin : limitation des tentatives de connexion",async()=>{
 const h=await startHarness({trustProxy:true});
 try{
 // Un seul proxy de confiance : la DERNIÈRE valeur de X-Forwarded-For compte ; la première (fournie par le client) ne permet pas de contourner le blocage.
 for(let i=0;i<5;i++)assert.equal((await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-Forwarded-For":"198.51.100."+i+", 203.0.113.9"},body:JSON.stringify({password:"wrong"})})).status,401);
 assert.equal((await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-Forwarded-For":"10.0.0.7, 203.0.113.9"},body:JSON.stringify({password:"wrong"})})).status,429);
 assert.equal((await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-Forwarded-For":"203.0.113.9, 198.51.100.1"},body:JSON.stringify({password:"wrong"})})).status,401,"autre dernière valeur : autre client");
 assert.equal((await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:"test-admin"})})).status,200);
 }finally{await h.close();}
});
test("Espace admin : connexion, liste et mise à jour de statut",async()=>{
 const h=await startHarness();
 try{
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,attachmentsFor(candidate),id))).status,200);
 let r=await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:""}});assert.equal(r.status,401);
 r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:"wrong"})});assert.equal(r.status,401);
 r=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:"test-admin"})});
 assert.equal(r.status,200);
 const cookie=r.headers.get("set-cookie").split(";")[0];
 r=await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie}});assert.equal(r.status,200);
 const list=await r.json();assert.ok(list.items.some(item=>item.id===id));
 r=await fetch(h.url+"/api/admin/dossiers/"+id,{method:"PATCH",headers:{Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify({status:"in_progress",adminNote:"Relire CNI"})});
 assert.equal(r.status,200);assert.equal((await r.json()).dossier.status,"in_progress");
 }finally{await h.close();}
});



test("Dates documentaires et justificatif de domicile (facture / quittance / avis)",()=>{
 for(const flow of ["ants","permis"]){
 const a={...candidate,workflow:flow};
 assert.equal(stepsFor(a).find(s=>s.id==="identity").fields.find(f=>f.key==="birthDate").required,true);
 for(const f of stepsFor(a).flatMap(s=>s.fields).filter(f=>["date","month","year"].includes(f.type) && f.key!=="homeDate")){
 assert.equal(f.required,false);assert.equal(fieldError(f,"",now),"");assert.ok(!f.label.includes("facultatif"));
 }
 }
 const identity=stepsFor(candidate).find(s=>s.id==="identityFiles").fields[0];
 assert.equal(identity.label,"Date d’expiration");
 assert.ok(fieldError(identity,"2026-02-31",now));
 assert.equal(fieldError(identity,"2020-01-01",now),"");
 for(const homeProof of ["facture","loyer"]){
 const a={...candidate,home:"own",homeProof,homeDate:"2026-08"};
 const date=stepsFor(a).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeDate");
 assert.equal(date.type,"month");assert.equal(date.label,"Mois et année du document");assert.equal(date.required,true);assert.equal(date.maxMonths,6);
 assert.ok(fieldError(date,"2026-08-01",now));assert.ok(fieldError(date,"2026-13",now));
 assert.ok(fieldError(date,"2027-01",now));assert.equal(fieldError(date,"2026-08",now),"");
 assert.ok(fieldError(date,"2025-12",now),"document trop ancien (> 6 mois)");
 assert.ok(fieldError(date,"2025",now),"année seule refusée pour facture/quittance");
 assert.equal(cleanAnswers(a).homeDate,"2026-08");
 assert.ok(auditText(a,[],now).includes("Mois et année du document : 08/2026"));
 assert.ok(stepsFor(a).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeProof").options.find(o=>o[0]===homeProof)[1].includes("moins de 6 mois"));
 }
 const tax={...candidate,home:"own",homeProof:"impot",homeDate:"2025"};
 const year=stepsFor(tax).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeDate");
 assert.equal(year.type,"year");assert.equal(year.label,"Année du document");assert.equal(year.required,true);assert.equal(year.maxMonths,undefined);
 assert.equal(fieldError(year,"2025",now),"");
 assert.ok(fieldError(year,"2025-08",now),"mois+année refusés pour l’avis d’imposition");
 assert.ok(fieldError(year,"2027",now),"année future refusée");
 assert.ok(fieldError(year,"",now));
 assert.equal(cleanAnswers(tax).homeDate,"2025");
 assert.ok(auditText(tax,[],now).includes("Année du document : 2025"));
 assert.ok(auditText(tax,[],now).includes("Dernier avis d’imposition"));
 assert.equal(stepsFor(tax).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeProof").options.find(o=>o[0]==="impot")[1],"Dernier avis d’imposition");
 assert.ok(!stepsFor(tax).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeProof").options.find(o=>o[0]==="impot")[1].includes("moins de 6 mois"));
 assert.equal(monthAge("2026-08",now),"Ancienneté en mois calendaires : 1 mois.");
 assert.equal(monthAge("2026-09",now),"Document du mois en cours");
 assert.equal(documentAge("2026-08-01",now),"Ancienneté : 1 mois et 7 jours");
 assert.equal(stepsFor(candidate).find(s=>s.id==="homeFiles").fields.some(f=>f.key==="hostingDate" || f.key==="parentExpiry"),false);
});
test("Ressortissant européen : situation et justificatif ciblé",()=>{
 for(const workflow of ["ants","permis"]){
  const base={...candidate,workflow,nationality:"etrangere",identityDocument:"cni_europe"};
  assert.match(stepsFor(base).find(s=>s.id==="identityDocument").fields[0].options.find(o=>o[0]==="cni_europe")[2],/plus de 6 mois sur le territoire français/);
  assert.deepEqual(stepsFor(base).find(s=>s.id==="identityDocument").fields[0].options.map(o=>o[0]),["sejour","cni_europe","passeport_etranger"]);
  assert.deepEqual(stepsFor(base).find(s=>s.id==="europeSituation").fields[0].options.map(o=>o[0]),["student","worker"]);
  for(const [situation,part] of [["student","scolarité"],["worker","paie"]]){
   const a={...base,europeSituation:situation};
   assert.equal(stepsFor(a).some(s=>s.id==="europeResidence"),true);
   assert.equal(documentsFor(a).find(d=>d.key==="europe_residence").label.includes(part),true);
   assert.ok(missingRequiredDocuments(a).some(d=>d.key==="europe_residence"));
  }
  assert.match(documentsFor({...base,europeSituation:"student"}).find(d=>d.key==="europe_residence").label,/Bulletin scolaire/);
  assert.match(documentsFor({...base,europeSituation:"worker"}).find(d=>d.key==="europe_residence").label,/Fiche de paie de plus de six mois/);
  assert.equal(stepsFor({...base,europeSituation:"other"}).some(s=>s.id==="europeResidence"),false);
  assert.equal(stepsFor({...base,identityDocument:"passeport_etranger"}).some(s=>s.id==="europeSituation"),false);
 }
});
test("Deux parcours : ordre commun, choix identiques, schéma exact",()=>{
 for(const workflow of ["ants","permis"]){
 const a={...candidate,workflow,medical:"non"};
 const steps=stepsFor(a);
 assert.deepEqual(steps.slice(0,3).map(s=>s.id),["identity","coordinates","nationality"]);
 assert.equal(steps[0].title,"Qui êtes-vous ?");assert.equal(steps[0].group,"Identité");
 assert.deepEqual(steps[0].fields.map(f=>[f.key,f.type,f.required]),[["birthName","text",true],["firstName","text",true],["birthDate","birthdate",true]]);
 assert.deepEqual(steps.find(s=>s.id==="identityDocument").fields,stepsFor(candidate).find(s=>s.id==="identityDocument").fields);
 assert.deepEqual(stepsFor({...a,nationality:"etrangere"}).find(s=>s.id==="identityDocument").fields[0].options.map(x=>x[0]),["sejour","cni_europe","passeport_etranger"]);
 assert.deepEqual(steps.map(s=>s.id),["identity","coordinates","nationality","identityDocument","identityFiles","ageFiles","home","homeFiles",...(workflow==="ants"?["special"]:["medical"]),"summary"]);
 if(workflow==="permis"){
  assert.ok(!stepsFor(a).some(s=>s.id==="permitType" || s.id==="permitFiles" || s.id==="emancipation"));
  assert.ok(!missingRequiredDocuments(a).map(d=>d.key).includes("permit_cepc"));
  assert.ok(!missingRequiredDocuments(a).map(d=>d.key).includes("permit_current"));
  // Ancien brouillon avec permitType / emancipated : cleanAnswers les ignore, soumission possible.
  const legacy=cleanAnswers({...a,permitType:"first",emancipated:"non"});
  assert.equal(legacy.permitType,undefined);
  assert.equal(legacy.emancipated,undefined);
  assert.equal(answerErrors(legacy,now).length,0);
 }
 assert.equal(steps.find(s=>s.id==="home").title,"Quelle est votre situation ?");
 assert.deepEqual(missingRequiredDocuments(a).map(d=>d.key).sort(),["assr_2","home_parents","hosting","identity_cni_fr","jdc","parent_identity"].sort());
 assert.ok(answerErrors({...a,birthDate:"",identityExpiry:"",homeDate:""}).some(e=>e.field==="birthDate"));
 assert.ok(answerErrors({...a,identityExpiry:"",homeDate:""},now).some(e=>e.field==="homeDate"));
 assert.equal(answerErrors({...a,identityExpiry:""},now).length,0);
 }
 assert.deepEqual(Object.keys(cleanAnswers(candidate)).sort(),["workflow","birthName","firstName","birthDate","phone","email","nationality","identityDocument","identityExpiry","home","homeProof","homeDate","special","deferred"].sort());
 for(const field of ["birthName","firstName","birthDate"])assert.deepEqual(answerErrors({...candidate,[field]:""}).map(e=>e.step),["identity"]);
 assert.deepEqual(answerErrors({...candidate,birthDate:"2015-01-01"}).map(e=>e.step),["identity"]);
 assert.ok(answerErrors({...candidate,workflow:"unknown"}).length);
 assert.ok(auditText({...candidate,birthDate:""},[],now).includes("âge non calculé"));
 assert.deepEqual(ageDocuments({...candidate,birthDate:""},now),[]);
});
test("Dates saisies au clavier : conversion, aller-retour, dates invalides",()=>{
 for(const [typed,iso,type] of [["12052030","2030-05-12","date"],["082026","2026-08","month"],["12/05/2030","2030-05-12","date"],["1/2/2030","2030-02-01","date"],["08/2026","2026-08","month"],["","","date"],["","","month"]]){
 assert.equal(dateFromInput(typed,type),iso);
 if(iso)assert.equal(dateFromInput(dateInputValue(iso,type),type),iso);
 }
 const f=stepsFor(candidate).find(s=>s.id==="identityFiles").fields[0];
 for(const typed of ["31/02/2026","date","12/0","00/12/2030"])assert.ok(fieldError(f,dateFromInput(typed),now));
});
test("ANTS et Permis : pièces obligatoires et dates documentaires facultatives",async()=>{
 const h=await startHarness();
 try{
 for(const workflow of ["ants","permis"]){
 const a={...candidate,workflow,special:"non",medical:"non",identityExpiry:"",homeDate:"2026-08"};
 assert.equal((await send(h,form(a,[]))).status,422);
 const partial=[{key:"identity_cni_fr",name:"identité.pdf",content:pdf}];
 assert.equal((await send(h,form(a,partial))).status,422);
 const attachments=attachmentsFor(a);
 const r=await send(h,form(a,attachments));assert.equal(r.status,200);
 const mail=h.messages.at(-1);assert.match(mail.subject,/a soumis son questionnaire|Nouveau dossier/);
 assert.ok(mail.text.includes("nolan@example.test"));
 assert.ok(mail.text.includes("DOCUMENTS TRANSMITS") || mail.text.includes("disponible dans l’Admin") || mail.text.includes("Admin"));
 }
 }finally{await h.close();}
});

test("Limite globale réelle : 17 Mo acceptés, un octet de plus refusé",async()=>{
 assert.equal(limits.totalBytes,17*1024*1024);
 const h=await startHarness();
 try{
 const file=size=>Buffer.concat([pdf,Buffer.alloc(Math.max(0,size-pdf.length))]);
 const base=attachmentsFor(candidate).filter(a=>a.key!=="identity_cni_fr");
 const baseSize=base.reduce((sum,f)=>sum+f.content.length,0);
 const budget=limits.totalBytes-baseSize;
 const first={key:"identity_cni_fr",name:"recto.pdf",content:file(Math.floor(budget/2))};
 const second={key:"identity_cni_fr",name:"verso.pdf",content:file(budget-first.content.length)};
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(candidate,[...base,first,second],id))).status,200);
 second.content=Buffer.concat([second.content,Buffer.from([0])]);
 assert.equal((await send(h,form(candidate,[...base,first,second],crypto.randomUUID()))).status,413);
 }finally{await h.close();}
});

test("Séparateurs automatiques et curseur",()=>{
 for(const [input,type,output] of [["19","date","19/"],["1912","date","19/12/"],["19122004","date","19/12/2004"],["08","month","08/"],["082026","month","08/2026"],["19/12/2004","date","19/12/2004"],["","date",""],["5/3/2004","date","05/03/2004"],["1/2/2030","date","01/02/2030"],["12/5/2030","date","12/05/2030"],["5/2030","month","05/2030"],["5","date","5"],["5/","date","05/"]])assert.equal(maskDate(input,type).text,output);
 assert.deepEqual(maskDate("19/12/2004","date",1),{text:"19/12/2004",caret:1});
 assert.deepEqual(maskDate("5/","date",2),{text:"05/",caret:3});
 assert.equal(dateFromInput(maskDate("5/3/2004").text),"2004-03-05");
});

test("Validation : année de naissance vraisemblable, tabulation refusée, cleanAnswers idempotent",()=>{
 const birth=stepsFor(candidate).find(s=>s.id==="identity").fields.find(f=>f.key==="birthDate");
 assert.equal(fieldError(birth,"1906-01-01",now),"Vérifiez l’année de naissance.");assert.equal(fieldError(birth,"1926-09-09",now),"");
 assert.ok(answerErrors({...candidate,birthDate:"1906-01-01"},now).some(e=>e.field==="birthDate"));
 const name=stepsFor(candidate).find(s=>s.id==="identity").fields.find(f=>f.key==="birthName");
 assert.equal(fieldError(name,"Lé\ta",now),"Caractère non autorisé.");assert.equal(fieldError(name,"Léa",now),"");
 const dirty={...candidate,special:"oui ",specialReason:"medical",home:"parents "};
 const clean=cleanAnswers(dirty);
 assert.equal(clean.special,"oui");assert.equal(clean.specialReason,"medical");assert.equal(clean.home,"parents");
 assert.equal(clean.hostingDate,undefined);assert.equal(clean.parentExpiry,undefined);
 assert.deepEqual(answerErrors(clean,now),[]);
 assert.deepEqual(cleanAnswers(clean),clean);
});

test("Identifiant compatible sans randomUUID, toujours UUID v4 cryptographique",()=>{
 const source={getRandomValues:array=>crypto.getRandomValues(array)};
 const values=Array.from({length:100},()=>newSubmissionId(source));
 assert.equal(new Set(values).size,100);
 for(const id of values)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.throws(()=>newSubmissionId({}),/navigateur/);
});

test("Pièces différées : périmètre, nettoyage, audit et pièces manquantes",()=>{
 const a={...candidate,workflow:"ants",special:"oui",specialReason:"medical"};
 const docs=documentsFor(a,now);
 assert.deepEqual(docs.filter(d=>d.deferrable).map(d=>d.key).sort(),["assr_2","home_parents","hosting","jdc","parent_identity","special_medical"].sort());
 assert.ok(!docs.find(d=>d.key==="identity_cni_fr").deferrable);
 const permit=documentsFor({...candidate,workflow:"permis",medical:"oui"},now);
 assert.ok(!permit.some(d=>d.key==="permit_current" || d.key==="permit_cepc"));
 assert.ok(permit.find(d=>d.key==="medical").deferrable);
 assert.deepEqual(cleanAnswers(candidate).deferred,[]);
 const clean=cleanAnswers({...a,deferred:["jdc"," hosting ","jdc",42,""]});
 assert.deepEqual(clean.deferred,["jdc","hosting"]);assert.equal(answerErrors(clean,now).length,0);
 assert.deepEqual(missingRequiredDocuments(clean,[]).map(d=>d.key).sort(),["assr_2","home_parents","identity_cni_fr","parent_identity","special_medical"].sort());
 assert.deepEqual(missingRequiredDocuments(clean,[{key:"jdc",name:"jdc.pdf"}]).map(d=>d.key).sort(),["assr_2","home_parents","identity_cni_fr","parent_identity","special_medical"].sort());
 assert.ok(answerErrors({...clean,deferred:["identity_cni_fr"]},now).some(e=>e.field==="deferred"));
 assert.ok(answerErrors({...clean,deferred:["medical"]},now).some(e=>e.field==="deferred"));
 assert.ok(answerErrors({...clean,deferred:"jdc"},now).some(e=>e.field==="deferred"));
 assert.ok(answerErrors(cleanAnswers({...candidate,workflow:"permis",deferred:["permit_current"]}),now).some(e=>e.field==="deferred"));
 assert.ok(missingRequiredDocuments({...candidate,deferred:["identity_cni_fr"]},[]).some(d=>d.key==="identity_cni_fr"));
 assert.deepEqual(deferredDocuments(clean,[{key:"jdc",name:"jdc.pdf"}],now).map(d=>d.key),["hosting"]);
 const text=auditText(clean,[{key:"identity_cni_fr",name:"cni.pdf"}],now);
 assert.ok(text.includes("PIÈCES À RÉCUPÉRER PAR AEM"));
 assert.ok(text.includes("JDC ou avis de situation :\n  À FOURNIR : le candidat indique ne pas avoir ce document ; à récupérer par AEM"));
 assert.ok(text.includes("  - Attestation d’hébergement datée d’aujourd’hui — À FOURNIR"));
 assert.ok(text.includes("ASSR 2 :\n  Aucun fichier transmis"));
 assert.ok(!auditText(candidate,[],now).includes("À FOURNIR"));
});
test("HTTP : pièces différées acceptées, identité jamais différable",async()=>{
 const h=await startHarness();
 try{
 const a={...candidate,deferred:["jdc","hosting","parent_identity"]};
 const attachments=attachmentsFor(candidate).filter(f=>!a.deferred.includes(f.key));
 assert.ok(attachments.some(f=>f.key==="identity_cni_fr"));
 let r=await send(h,form(a,attachments));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
 const {readFile}=await import("node:fs/promises");
 const dirs=(await import("node:fs/promises")).readdir(h.dataDir);
 const meta=JSON.parse(await readFile(h.dataDir+"/"+(await dirs).find(d=>/^[a-f0-9-]{36}$/.test(d))+"/meta.json","utf8"));
 assert.deepEqual(meta.answers.deferred,a.deferred);
 assert.equal(meta.incomplete,true);assert.ok(meta.history[0].details.includes("3 pièce(s) à récupérer"));
 const notice=h.messages[0].text;
 assert.ok(notice.includes("Pièces à récupérer") || notice.includes("JDC") || notice.includes("restent à récupérer"),"mention des pièces à récupérer");
 assert.ok(notice.includes("zone admin") || notice.includes("Admin") || notice.includes("admin"),"lien ou mention admin");
 assert.ok(notice.includes("Attestation d’hébergement") || notice.includes("hébergement"));
 assert.equal((await send(h,form(a,attachments.filter(f=>f.key!=="identity_cni_fr")))).status,422);
 assert.equal((await send(h,form({...a,deferred:[...a.deferred,"identity_cni_fr"]},attachments.filter(f=>f.key!=="identity_cni_fr")))).status,422);
 assert.equal((await send(h,form({...a,deferred:["assr_15"]},attachments))).status,422);
 // Ancienne clé permit_current différée : refusée (document inconnu pour le nouveau parcours).
 const permitLegacy={...candidate,workflow:"permis",medical:"oui",deferred:["permit_current"]};
 assert.equal((await send(h,form(permitLegacy,attachmentsFor({...candidate,workflow:"permis",medical:"oui"})))).status,422);
 const deferredMedical={...candidate,workflow:"permis",medical:"oui",deferred:["medical"]};
 assert.equal((await send(h,form(deferredMedical,attachmentsFor(deferredMedical).filter(f=>f.key!=="medical")))).status,200);
 assert.ok(h.messages.at(-1).subject.includes("a soumis son questionnaire") || h.messages.at(-1).subject.includes("[AEM Admin]"));
 assert.ok(h.messages.at(-1).text.includes("Avis médical") || h.messages.at(-1).text.includes("récupérer"));
 }finally{await h.close();}
});

test("Justificatif de domicile différé : type et mois non bloquants",()=>{
 for(const home of ["own","parents"]){
 const a=cleanAnswers({...candidate,home,homeProof:"",homeDate:"",deferred:["home_"+home]});
 const proof=stepsFor(a).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeProof");
 assert.equal(proof.required,false);assert.equal(fieldError(proof,"",now),"");assert.ok(fieldError(proof,"autre",now));
 assert.equal(answerErrors(a,now).length,0);
 assert.ok(!missingRequiredDocuments(a,[],now).some(d=>d.key==="home_"+home));
 const strict=cleanAnswers({...candidate,home,homeProof:"",homeDate:""});
 assert.equal(stepsFor(strict).find(s=>s.id==="homeFiles").fields.find(f=>f.key==="homeProof").required,true);
 assert.ok(answerErrors(strict,now).some(e=>e.field==="homeProof"));
 assert.ok(answerErrors(strict,now).some(e=>e.field==="homeDate"));
 }
});

test("Champs nominatifs : ni lien, ni adresse, ni texte long (anti-relais de courrier)",()=>{
 const fields=Object.fromEntries(stepsFor({...candidate,birthDate:"2009-03-12"}).flatMap(s=>s.fields).map(f=>[f.key,f]));
 for(const key of ["birthName","firstName","contactName"]){
 for(const bad of ["Voir https://exemple.test","Cliquez sur www.exemple.test","nolan@exemple.test","A".repeat(81)])assert.equal(fieldError(fields[key],bad,now),"Ce champ ne doit contenir que votre nom.",key+" : "+bad.slice(0,20));
 assert.equal(fieldError(fields[key],"Jean-Pierre d’Aubigné de la Tour",now),"");
 }
 assert.equal(fieldError(fields.email,"nolan@example.test",now),"");
 assert.ok(answerErrors({...candidate,birthName:"GRAYSON http://evil.test"},now).some(e=>e.field==="birthName"));
 assert.equal(answerErrors(candidate,now).length,0);
});

test("Stockage : écritures concurrentes sérialisées, aucune entrée d’historique perdue",async()=>{
 const storage=createStorage("test-results/storage-"+crypto.randomUUID());
 const submission={submissionId:crypto.randomUUID(),answers:cleanAnswers(candidate),uploads:[]};
 await storage.save(submission,"audit",{incomplete:true,deferredCount:2});
 await Promise.all(Array.from({length:8},(_,i)=>storage.update(submission.submissionId,{},{by:"test",action:"note",details:"Entrée "+i})));
 const meta=await storage.get(submission.submissionId);
 assert.equal(meta.history.length,9);
 assert.deepEqual(meta.history.slice(1).map(e=>e.details).sort(),Array.from({length:8},(_,i)=>"Entrée "+i));
 assert.ok(meta.history[0].details.includes("2 pièce(s) à récupérer"));
 assert.equal((await storage.list())[0].incomplete,true);
});

test("Conservation : tout dossier effacé après le délai, dossier classé effacé plus tôt (politique de confidentialité)",async()=>{
 const storage=createStorage("test-results/purge-"+crypto.randomUUID());
 const day=86400000;
 const mk=async()=>{const s={submissionId:crypto.randomUUID(),answers:cleanAnswers(candidate),uploads:[]};await storage.save(s,"audit");return s.submissionId;};
 const recent=await mk(),old=await mk(),archived=await mk();
 await storage.update(archived,{status:"archived"},{by:"test",action:"status",details:"classé"});
 // Un dossier « Reçu » d'il y a 13 mois est effacé ; un dossier classé depuis 4 mois aussi ; un dossier récent reste.
 assert.equal(await storage.purgeOlderThan(365,90,Date.now()+400*day),3);
 assert.equal((await storage.list()).length,0);
 const again=await mk();await storage.update(again,{status:"archived"},{by:"test",action:"status",details:"classé"});
 assert.equal(await storage.purgeOlderThan(365,90,Date.now()+30*day),0,"classé depuis moins de 90 jours : conservé");
 assert.equal(await storage.purgeOlderThan(365,90,Date.now()+100*day),1,"classé depuis plus de 90 jours : effacé");
 assert.equal(await storage.purgeOlderThan(0),0);
});
