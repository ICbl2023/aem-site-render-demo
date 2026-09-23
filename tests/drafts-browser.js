// Scénarios réels de reprise : navigateur fermé puis relancé, fichiers vérifiés après transmission.
import assert from "node:assert/strict";
import path from "node:path";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {createApp} from "../questionnaires-autonomes/server.js";
import {stepsFor,dateInputValue} from "../logic.js";
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(".browser-cache");
const {chromium,webkit,devices}=await import("playwright");
const runId=crypto.randomUUID(),out=path.resolve("test-results","drafts-"+runId);
await mkdir(out,{recursive:true});
const origin="http://127.0.0.1:4195";
const app=createApp({config:{standalone:true,origin,dataDir:path.join(out,"server-data"),draftDir:path.join(out,"brouillons"),receiptDir:path.join(out,"receipts"),adminAccounts:"test:test-admin:responsable",adminPassword:"",candidateMail:false,aiEnabled:false,from:"",recipient:"",smtpHost:""}});
await new Promise((resolve,reject)=>{app.once("error",reject);app.listen(4195,"127.0.0.1",resolve);});
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=","base64");
const pdf=Buffer.from("%PDF-1.4\n% DOCUMENT FICTIF DE REPRISE AEM\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const person=workflow=>({workflow,birthName:"EXEMPLE",firstName:"Vergil",birthDate:"1990-03-12",phone:"0600000000",email:"vergil@example.test",nationality:"etrangere",identityDocument:"cni_europe",europeSituation:"student",home:"own",homeProof:"facture",homeDate:"2026-08",special:"non",medical:"non"});
const results=[],contexts=new Set(),pageErrors=[];
async function persistent(engine,name){
 const options={headless:true,viewport:{width:390,height:844},reducedMotion:"reduce",...(engine==="chromium"?{executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"}:{...devices["iPhone 13"]})};
 const context=await (engine==="chromium"?chromium:webkit).launchPersistentContext(path.join(out,"profiles",name),options);
 context.setDefaultTimeout(10000);contexts.add(context);
 context.on("page",page=>watch(page));for(const page of context.pages())watch(page);
 return context;
}
function watch(page){page.on("pageerror",error=>pageErrors.push(error.message));}
const state=page=>page.evaluate(()=>window.aemForm?.state().id);
const waitState=(page,id)=>page.waitForFunction(expected=>window.aemForm?.state().id===expected,id);
const saved=page=>page.locator('.draft-bar[data-state="saved"]').waitFor();
async function fresh(page,workflow){
 await page.goto(origin+"/"+workflow+".html");
 await page.getByRole("button",{name:"Commencer mon dossier",exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"En parlant",exact:true}).count(),0);
 assert.equal(await page.locator(".assist-mic").count(),0);
 assert.equal(await page.getByRole("button",{name:/En écrivant/}).count(),0);
 assert.equal(await page.locator(".assist-tabs").count(),0);
}
async function start(page,workflow){
 await fresh(page,workflow);await page.getByRole("button",{name:"Commencer mon dossier",exact:true}).click();await waitState(page,"identity");
}
async function next(page,id){await page.locator("#next-button").click();await waitState(page,id);}
async function fillStep(page,a){
 const current=await state(page),step=stepsFor(a).find(s=>s.id===current);
 assert.ok(step,"étape reconnue : "+current);
 for(const field of step.fields){
  if(field.type==="choice")await page.locator('label.choice-card:has(input[name="'+field.key+'"][value="'+a[field.key]+'"])').click();
  else await page.locator("#field-"+field.key).fill(["date","month","birthdate"].includes(field.type)?dateInputValue(a[field.key],field.type==="month"?"month":"date"):a[field.key]||"");
 }
 for(const input of await page.locator('input[type="file"][id^="upload-"]').all()){
  await input.setInputFiles({name:current+".pdf",mimeType:"application/pdf",buffer:pdf});
 }
}
async function toFiles(page,flow){
 const a=person(flow);
 await start(page,flow);await fillStep(page,a);await next(page,"coordinates");
 assert.equal(await page.locator('label[for="field-phone"]').innerText(),"Ton téléphone");
 assert.equal(await page.locator('label[for="field-email"]').innerText(),"Ton email");
 await fillStep(page,a);await next(page,"nationality");await fillStep(page,a);await next(page,"identityDocument");
 assert.deepEqual(await page.locator('input[name="identityDocument"]').evaluateAll(inputs=>inputs.map(input=>input.value)),["sejour","cni_europe","passeport_etranger"]);
 assert.match(await page.locator(".identity-choices").innerText(),/Titre de séjour français/);
 assert.match(await page.locator(".identity-choices").innerText(),/plus de 6 mois/);
 await fillStep(page,a);await next(page,"europeSituation");await fillStep(page,a);await next(page,"identityFiles");
 await page.locator("#upload-identity_cni_europe").setInputFiles([{name:"recto.png",mimeType:"image/png",buffer:png},{name:"verso.pdf",mimeType:"application/pdf",buffer:pdf}]);
 await saved(page);
 return a;
}
async function record(page,flow){return page.evaluate(async workflow=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("aem-questionnaire-drafts",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const data=await new Promise((resolve,reject)=>{const tx=db.transaction("drafts"),r=tx.objectStore("drafts").get("/:"+workflow);tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error);});
 db.close();return data?{...data,files:data.files.map(f=>({key:f.key,name:f.name,size:f.size,present:Boolean(f.blob)}))}:null;
 },flow);}
async function alter(page,flow,change){await page.evaluate(async({workflow,change})=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("aem-questionnaire-drafts",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise((resolve,reject)=>{const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts"),r=store.get("/:"+workflow);
 r.onsuccess=()=>{const value=r.result;if(change==="missing")value.files.forEach(file=>file.blob=null);if(change==="expire")value.expiresAt=Date.now()-1000;store.put(value,"/:"+workflow);};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 },{workflow:flow,change});}
async function resume(page,flow,expected){
 await page.goto(origin+"/"+flow+".html");await waitState(page,expected);
}
// L'échéance des 7 jours est tenue par le serveur, qui efface le brouillon et invalide son lien de reprise.
// Pour l'éprouver depuis le navigateur, on expire la copie locale et on purge le brouillon partagé.
async function expireEverywhere(page,flow){
 await alter(page,flow,"expire");
 await page.evaluate(async()=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith("aem-draft-token:"));
  if(key)await fetch("./api/draft",{method:"DELETE",headers:{"X-AEM-Request":"questionnaire","X-AEM-Draft":localStorage.getItem(key)}});
 });
}
async function admin(pathname){
 const login=await fetch(origin+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1","Origin":origin},body:JSON.stringify({user:"test",password:"test-admin"})});
 assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0];
 return fetch(origin+"/api/admin/"+pathname,{headers:{Cookie:cookie,"X-AEM-Admin":"1"}});
}
try{
 for(const route of ["/ants.html","/permis.html","/drafts.js","/draft-ui.js","/draft-remote.js","/api/config","/admin.html"]){assert.equal((await fetch(origin+route)).status,200,route);}
 for(const route of ["/formations.html","/tarifs.html","/voice.js","/voice/manifest.json","/server.js","/.env"]){assert.equal((await fetch(origin+route)).status,404,route);}
 assert.match(await (await fetch(origin+"/")).text(),/ANTS, Permis et administration/);
 results.push("Paquet extrait : accès autonomes, ressources complètes, pages du site et fichiers privés absents.");
 let engines=process.argv.includes("--chrome-only")?["chromium"]:process.argv.includes("--webkit-only")?["webkit"]:["chromium","webkit"];
 if(engines.includes("webkit")){
  const {webkitLaunchError,WEBKIT_SKIP_HINT}=await import("./webkit-available.js");
  const skip=await webkitLaunchError();
  if(skip){
   console.log(WEBKIT_SKIP_HINT+"\nDétail Playwright : "+skip.split("\n")[0]);
   if(process.argv.includes("--webkit-only")){
    await new Promise(r=>app.close(r));
    process.exit(0);
   }
   engines=engines.filter(engine=>engine!=="webkit");
  }
 }
 for(const engine of engines){
  for(const flow of ["ants","permis"]){
   let context=await persistent(engine,engine+"-"+flow),page=context.pages()[0]||await context.newPage();
   const a=await toFiles(page,flow);
   for(const width of [320,390,768,1366]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,engine+" : pas de débordement à "+width);
   }
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:path.join(out,engine+"-"+flow+"-pieces.png"),fullPage:true});
   await next(page,"europeResidence");await fillStep(page,a);await next(page,"home");await saved(page);
   const before=await record(page,flow);
   assert.ok(before.files.length>=2);assert.ok(before.files.every(file=>file.present));assert.ok(before.files.some(file=>file.key==="identity_cni_europe"));assert.ok(before.files.some(file=>file.key==="europe_residence"));
   await context.close();contexts.delete(context);
   context=await persistent(engine,engine+"-"+flow);page=context.pages()[0]||await context.newPage();
   await page.goto(origin+"/"+flow+".html");
   await waitState(page,"home");
   await page.locator(".draft-bar").getByRole("button",{name:"Recommencer",exact:true}).waitFor();
   await page.screenshot({path:path.join(out,engine+"-"+flow+"-reprise.png"),fullPage:true});
   assert.equal(await page.evaluate(()=>window.aemForm.answers().firstName),"Vergil");
   assert.equal((await record(page,flow)).submissionId,before.submissionId);
   await page.locator("#question-card .back-button").click();await waitState(page,"europeResidence");
   assert.ok(await page.locator(".file-row").count()>=1);
   await page.locator("#question-card .back-button").click();await waitState(page,"identityFiles");
   assert.ok(await page.locator(".file-row").count()>=2);
   assert.match(await page.locator(".file-list").innerText(),/recto.png/);
   assert.match(await page.locator(".file-list").innerText(),/verso.pdf/);
   await next(page,"europeResidence");await fillStep(page,a);await next(page,"home");
   // L'autre questionnaire garde son propre brouillon, même si le premier est ensuite envoyé.
   const other=flow==="ants"?"permis":"ants",otherPage=await context.newPage();
   await start(otherPage,other);await otherPage.locator("#field-birthName").fill("AUTRE DEMARCHE");await saved(otherPage);await otherPage.close();
   while(await state(page)!=="summary"){
    const current=await state(page);await fillStep(page,a);
    const pathSteps=stepsFor(a),index=pathSteps.findIndex(step=>step.id===current);await next(page,pathSteps[index+1].id);
   }
   await saved(page);
   const expectedId=(await record(page,flow)).submissionId;
   await page.route("**/api/submit",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"Interruption simulée de l’envoi."})}));
   await page.locator("#send-confirm").waitFor();await page.locator("#send-confirm").check();await page.locator("#send-button").click();await page.locator("#send-error").waitFor();await saved(page);
   assert.equal((await record(page,flow)).submissionId,expectedId);
   await page.unroute("**/api/submit");await resume(page,flow,"summary");
   const consentText=await page.locator("label.consent").innerText();assert.match(consentText,flow==="ants"?/pour traiter ma démarche ANTS/:/pour traiter ma démarche permis/);assert.doesNotMatch(consentText,/ANTS ou permis|Conformément à sa/);
   assert.equal(await page.locator("#send-confirm").isChecked(),false,"le consentement n'est pas précoché à la reprise");
   await page.locator("#send-confirm").check();await page.locator("#send-button").click();await page.locator(".success-badge").waitFor();
   assert.equal(await record(page,flow),null,"le brouillon est supprimé après confirmation");
   assert.equal((await record(page,other)).answers.birthName,"AUTRE DEMARCHE");
   const dossierResponse=await admin("dossiers/"+expectedId);assert.equal(dossierResponse.status,200);
   const detail=await dossierResponse.json(),dossier=detail.dossier||detail;
   assert.match(dossier.auditText,/Vergil/);assert.match(dossier.auditText,/recto.png/);
   const first=await admin("dossiers/"+expectedId+"/files/0");assert.deepEqual(Buffer.from(await first.arrayBuffer()),png,"octets du PNG conservés après fermeture et envoi");
   const second=await admin("dossiers/"+expectedId+"/files/1");assert.deepEqual(Buffer.from(await second.arrayBuffer()),pdf,"octets du PDF conservés après fermeture et envoi");
   await fresh(page,flow);
   results.push(engine+" "+flow+" : fermeture et réouverture du navigateur, réponses, étape, vrais fichiers, échec puis reprise du même envoi, audit serveur et effacement isolé.");
   await context.close();contexts.delete(context);
  }
 }
 // Cas de reprise dégradée et de contrôle de l'effacement sur les deux démarches.
 for(const flow of ["ants","permis"]){
  const context=await persistent("chromium","fault-"+flow),page=context.pages()[0]||await context.newPage();
  await toFiles(page,flow);
  await alter(page,flow,"missing");await resume(page,flow,"identityFiles");
  // IndexedDB a perdu les octets : le serveur les restitue, les pièces ne sont pas à rephotographier.
  assert.ok(await page.locator(".file-row").count()>=2);
  assert.match(await page.locator(".file-list").innerText(),/recto.png/);
  assert.equal(await page.locator(".missing-file").count(),0);
  assert.equal(await page.evaluate(()=>window.aemForm.answers().firstName),"Vergil");
  page.once("dialog",dialog=>dialog.dismiss());
  await page.reload();await waitState(page,"identityFiles");
  await page.locator(".draft-bar").getByRole("button",{name:"Recommencer",exact:true}).waitFor();
  await page.locator(".draft-bar").getByRole("button",{name:"Recommencer",exact:true}).click();
  assert.equal(await state(page),"identityFiles");assert.ok(await record(page,flow));
  page.once("dialog",dialog=>dialog.accept());await page.locator(".draft-bar").getByRole("button",{name:"Recommencer",exact:true}).click();await waitState(page,"welcome");
  assert.equal(await record(page,flow),null);
  await toFiles(page,flow);await expireEverywhere(page,flow);await page.reload();
  await page.getByRole("button",{name:"Commencer mon dossier",exact:true}).waitFor();
  assert.equal(await page.locator(".draft-bar").getByRole("button",{name:"Recommencer",exact:true}).count(),0);assert.equal(await record(page,flow),null);
  results.push(flow+" : fichiers perdus localement restitués par le serveur, annulation/confirmation d'effacement, expiration à 7 jours.");
  await context.close();contexts.delete(context);
 }
 // Sauvegarde refusée : aucune fausse confirmation, puis récupération.
 {
  const context=await persistent("chromium","unavailable"),page=context.pages()[0]||await context.newPage();
  await start(page,"ants");await saved(page);
  await page.evaluate(()=>{window.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException("Quota simulé","QuotaExceededError");};});
  await page.locator("#field-birthName").fill("NON ENREGISTRE");await page.locator('.draft-bar[data-state="error"]').waitFor();
  assert.match(await page.locator("#draft-status").innerText(),/ne sont pas enregistrées/);
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
  await page.getByRole("button",{name:"Réessayer la sauvegarde",exact:true}).click();await saved(page);
  await resume(page,"ants","identity");assert.equal(await page.locator("#field-birthName").inputValue(),"NON ENREGISTRE");
  results.push("Échec de sauvegarde signalé sans faux succès ; réessai puis reprise des réponses.");
  await context.close();contexts.delete(context);
 }
 // Quota réservé aux octets : les réponses seules restent récupérables, noms jamais assimilés à des fichiers.
 {
  const context=await persistent("chromium","partial"),page=context.pages()[0]||await context.newPage();
  await start(page,"permis");
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(value.files?.some(item=>item.blob))throw new DOMException("Quota fichiers simulé","QuotaExceededError");return put.call(this,value,...args);};});
  const a=person("permis");
  for(const id of ["identity","coordinates","nationality","identityDocument"]){await waitState(page,id);await fillStep(page,a);const steps=stepsFor(a);await next(page,steps[steps.findIndex(step=>step.id===id)+1].id);}
  await fillStep(page,a);await next(page,"identityFiles");
  await page.locator("#upload-identity_cni_europe").setInputFiles({name:"a-rejoindre.png",mimeType:"image/png",buffer:png});
  await page.locator('.draft-bar[data-state="partial"]').waitFor();
  await resume(page,"permis","identityFiles");
  assert.match(await page.locator(".file-list").innerText(),/a-rejoindre.png/);
  assert.equal(await page.evaluate(()=>window.aemForm.answers().email),a.email);
  // IndexedDB a refusé les octets, le serveur les a pris : la pièce n'est pas à rephotographier.
  assert.equal(await page.locator(".missing-file").count(),0);
  results.push("Quota de fichiers : sauvegarde partielle annoncée, réponses restaurées et pièce reprise depuis le serveur.");
  await context.close();contexts.delete(context);
 }
 // Mode assistant écrit retiré : seul le formulaire manuel reste.
 for(const flow of ["ants","permis"]){
  const context=await persistent("chromium","written-"+flow),page=context.pages()[0]||await context.newPage();
  await fresh(page,flow);
  assert.equal(await page.getByRole("button",{name:/En écrivant/}).count(),0);
  assert.equal(await page.locator(".assist-tabs").count(),0);
  results.push(flow+" : pas d’assistant écrit, formulaire seul.");
  await context.close();contexts.delete(context);
 }

 // Saisie interrompue au milieu d'une date : ne pas normaliser ou éliminer les réponses incomplètes.
 {
  const context=await persistent("chromium","partial-input"),page=context.pages()[0]||await context.newPage();
  await start(page,"ants");await page.locator("#field-firstName").fill("Vergil");await page.locator("#field-birthDate").fill("12/0");await saved(page);
  await resume(page,"ants","identity");assert.equal(await page.locator("#field-birthDate").inputValue(),"12/0");assert.equal(await page.locator("#field-firstName").inputValue(),"Vergil");
  results.push("Réponse partiellement saisie : date incomplète et étape conservées après rechargement.");
  await context.close();contexts.delete(context);
 }
 // Un navigateur qui refuse entièrement IndexedDB reste utilisable et n'annonce pas une sauvegarde.
 {
  const context=await persistent("chromium","no-idb");await context.addInitScript(()=>Object.defineProperty(window,"indexedDB",{value:undefined,configurable:true}));
  const page=await context.newPage();await start(page,"permis");await page.locator("#field-firstName").fill("Vergil");
  await page.locator('.draft-bar[data-state="error"]').waitFor();assert.equal(await page.locator('.draft-bar[data-state="saved"]').count(),0);
  assert.equal(await page.locator("#field-firstName").inputValue(),"Vergil");
  results.push("Stockage navigateur indisponible : formulaire utilisable, échec signalé, aucune fausse sauvegarde.");
  await context.close();contexts.delete(context);
 }
 // Deux onglets : un ancien état ne peut pas écraser silencieusement des réponses plus récentes.
 {
  const context=await persistent("chromium","two-tabs"),first=context.pages()[0]||await context.newPage();
  await start(first,"ants");await first.locator("#field-firstName").fill("Premier");await saved(first);
  const second=await context.newPage();await resume(second,"ants","identity");
  await first.locator("#field-firstName").fill("Plus récent");await saved(first);
  await second.locator("#field-firstName").fill("Ancien onglet");await second.locator('.draft-bar[data-state="error"]').waitFor();
  assert.match(await second.locator("#draft-status").innerText(),/autre onglet/);
  assert.equal((await record(second,"ants")).answers.firstName,"Plus récent");
  results.push("Deux onglets : conflit signalé, réponses les plus récentes préservées.");
  await context.close();contexts.delete(context);
 }
 // Un conflit de brouillon ne doit pas être contourné par l'envoi final du dossier périmé.
 {
  const context=await persistent("chromium","submit-conflict"),page=context.pages()[0]||await context.newPage();
  const a=await toFiles(page,"ants");
  while(await state(page)!=="summary"){
   const current=await state(page);await fillStep(page,a);
   const steps=stepsFor(a);await next(page,steps[steps.findIndex(step=>step.id===current)+1].id);
  }
  await saved(page);
  const token=await page.evaluate(()=>localStorage.getItem("aem-draft-token:/:ants"));
  const headers={"X-AEM-Request":"questionnaire","X-AEM-Draft":token,Origin:origin};
  const latest=(await (await fetch(origin+"/api/draft",{headers})).json()).draft;
  const updated=await fetch(origin+"/api/draft",{method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({...latest,answers:{...latest.answers,firstName:"Modifié ailleurs"}})});
  assert.equal(updated.status,200);
  let submissions=0;page.on("request",request=>{if(request.url()===origin+"/api/submit")submissions++;});
  await page.locator("#send-confirm").check();await page.locator("#send-button").click();
  await page.locator("#send-error").waitFor();
  assert.match(await page.locator("#send-error").innerText(),/modifié|conflit/i);
  assert.equal(submissions,0,"aucun envoi périmé après un 409 de sauvegarde");
  const preserved=await fetch(origin+"/api/draft",{headers});assert.equal(preserved.status,200);
  assert.equal((await preserved.json()).draft.answers.firstName,"Modifié ailleurs");
  results.push("Conflit avant envoi : envoi bloqué, lien et version de l'autre appareil conservés.");
  await context.close();contexts.delete(context);
 }
 // Une confirmation serveur reste un succès même si le navigateur refuse ensuite l'effacement local.
 {
  const context=await persistent("chromium","delete-failure"),page=context.pages()[0]||await context.newPage();
  const a=await toFiles(page,"ants");await next(page,"europeResidence");await fillStep(page,a);await next(page,"home");
  while(await state(page)!=="summary"){
   const current=await state(page);await fillStep(page,a);
   const steps=stepsFor(a);await next(page,steps[steps.findIndex(step=>step.id===current)+1].id);
  }
  await saved(page);
  await page.evaluate(()=>{window.originalDelete=IDBObjectStore.prototype.delete;IDBObjectStore.prototype.delete=function(){throw new DOMException("Effacement refusé pour le test","UnknownError");};});
  await page.locator("#send-confirm").check();await page.locator("#send-button").click();await page.locator(".success-badge").waitFor();
  assert.match(await page.locator("#draft-status").innerText(),/bien été envoyé.*pas pu être effacé/);
  assert.ok(await record(page,"ants"));assert.equal(await page.locator("#send-button").count(),0);
  await page.evaluate(()=>{IDBObjectStore.prototype.delete=window.originalDelete;});
  await page.getByRole("button",{name:"Effacer le brouillon envoyé",exact:true}).click();await page.locator('.draft-bar[data-state="sent"]').waitFor();
  assert.equal(await record(page,"ants"),null);
  results.push("Échec d'effacement après envoi : succès serveur distinct, avertissement local puis effacement réussi sans nouvel envoi.");
  await context.close();contexts.delete(context);
 }

 // Photo via le raccourci caméra : sans DataTransfer (Safari iOS).
 {
  const context=await persistent("chromium","camera-shot"),page=context.pages()[0]||await context.newPage();
  await toFiles(page,"ants");
  await page.locator("#shot-identity_cni_europe").setInputFiles({name:"photo-camera.png",mimeType:"image/png",buffer:png});
  await saved(page);
  assert.match(await page.locator(".file-list").innerText(),/photo-camera.png/);
  results.push("Prendre en photo : la pièce rejoint le dossier sans passer par DataTransfer.");
  await context.close();contexts.delete(context);
 }

 // Coupure réseau : réponses conservées localement, message clair, synchro au retour.
 {
  const context=await persistent("chromium","offline"),page=context.pages()[0]||await context.newPage();
  await start(page,"ants");await page.locator("#field-firstName").fill("Audrey");await saved(page);
  const token=await page.evaluate(()=>{
   const key=Object.keys(localStorage).find(k=>k.startsWith("aem-draft-token:"));
   return key?localStorage.getItem(key):"";
  });
  assert.ok(token);
  await context.setOffline(true);
  await page.locator("#field-birthName").fill("HORSLIGNE");
  await page.locator('.draft-bar[data-state="partial"]').waitFor();
  assert.match(await page.locator("#draft-status").innerText(),/Réseau indisponible/);
  assert.equal((await record(page,"ants")).answers.birthName,"HORSLIGNE");
  await page.getByRole("button",{name:"Réessayer la sauvegarde",exact:true}).waitFor();
  const isolated=await fetch(origin+"/api/draft",{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.notEqual((await isolated.json()).draft.answers.birthName,"HORSLIGNE");
  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event("online")));
  await saved(page);
  const synced=await fetch(origin+"/api/draft",{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal((await synced.json()).draft.answers.birthName,"HORSLIGNE");
  results.push("Absence de réseau : sauvegarde locale, message clair, bouton réessayer, synchro au retour sans écraser le serveur.");
  // La page reste servie, mais son API devient inaccessible pendant un rechargement.
  await context.route("**/api/draft",route=>route.abort());
  await page.locator("#field-birthName").fill("CACHE APRES COUPURE");
  await page.locator('.draft-bar[data-state="partial"]').waitFor();
  await page.reload();await waitState(page,"identity");
  assert.equal(await page.locator("#field-birthName").inputValue(),"CACHE APRES COUPURE");
  await page.locator("#field-birthName").fill("CACHE APRES RECHARGEMENT");
  await page.locator('.draft-bar[data-state="partial"]').waitFor();
  await context.unroute("**/api/draft");
  await page.evaluate(()=>window.dispatchEvent(new Event("online")));await saved(page);
  const resumed=await fetch(origin+"/api/draft",{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal((await resumed.json()).draft.answers.birthName,"CACHE APRES RECHARGEMENT");
  // Fermer avec une saisie non synchronisée, puis rouvrir connecté : elle doit être envoyée automatiquement.
  await context.setOffline(true);
  await page.locator("#field-birthName").fill("CACHE APRES FERMETURE");
  await page.locator('.draft-bar[data-state="partial"]').waitFor();
  await context.close();contexts.delete(context);
  const reopened=await persistent("chromium","offline"),again=reopened.pages()[0]||await reopened.newPage();
  await resume(again,"ants","identity");await saved(again);
  assert.equal(await again.locator("#field-birthName").inputValue(),"CACHE APRES FERMETURE");
  const final=await fetch(origin+"/api/draft",{headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token}});
  assert.equal((await final.json()).draft.answers.birthName,"CACHE APRES FERMETURE");
  results.push("Rechargement avec API coupée et fermeture hors ligne : saisie conservée, synchronisation au retour sans 409 contre soi-même.");
  await reopened.close();contexts.delete(reopened);
 }

 // Un conflit détecté par la sauvegarde doit aussi empêcher l'envoi de cet ancien état.
 {
  const context=await persistent("chromium","conflict-submit"),page=context.pages()[0]||await context.newPage();
  const a=await toFiles(page,"ants");
  while(await state(page)!=="summary"){
   const current=await state(page);await fillStep(page,a);
   const steps=stepsFor(a);await next(page,steps[steps.findIndex(step=>step.id===current)+1].id);
  }
  await saved(page);
  const token=await page.evaluate(()=>localStorage.getItem("aem-draft-token:/:ants"));
  const headers={"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token};
  const {draft}=await (await fetch(origin+"/api/draft",{headers})).json();
  const updated=await fetch(origin+"/api/draft",{method:"PUT",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({...draft,answers:{...draft.answers,firstName:"Modifié ailleurs"}})});
  assert.equal(updated.status,200);
  let submissions=0;
  await page.route("**/api/submit",route=>{submissions++;return route.abort();});
  await page.locator("#send-confirm").check();await page.locator("#send-button").click();await page.locator("#send-error").waitFor();
  assert.equal(submissions,0,"aucun envoi final après un conflit de brouillon");
  assert.match(await page.locator("#send-error").innerText(),/modifié|conflit/i);
  assert.equal((await (await fetch(origin+"/api/draft",{headers})).json()).draft.answers.firstName,"Modifié ailleurs");
  results.push("Conflit avant envoi : aucune soumission de l'ancien état, dernière version serveur et lien conservés.");
  await context.close();contexts.delete(context);
 }

 assert.deepEqual(pageErrors,[]);
 console.log(results.join("\n"));console.log("Vérifications réussies : "+results.length+" scénarios. Captures : "+out);
 await writeFile(path.join(out,"resultats.json"),JSON.stringify({ok:true,results,pageErrors},null,2));
}catch(error){
 console.error(error);
 for(const context of contexts)for(const page of context.pages())await page.screenshot({path:path.join(out,"failure-"+crypto.randomUUID()+".png"),fullPage:true}).catch(()=>{});
 await writeFile(path.join(out,"resultats.json"),JSON.stringify({ok:false,results,pageErrors,error:String(error),stack:error.stack},null,2));
 process.exitCode=1;
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 await new Promise(resolve=>app.close(resolve));
}
