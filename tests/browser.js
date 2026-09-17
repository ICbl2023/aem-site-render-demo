import {chromium} from "playwright";
import assert from "node:assert/strict";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {startHarness,png,pdf,heic,candidate} from "./helpers.js";
import {stepsFor,cleanAnswers,subjectFor,dateInputValue,documentsFor,limits} from "../logic.js";
const h=await startHarness({port:4173});
let browser;
const results=[],errors=[];
try{
 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 await mkdir("test-results",{recursive:true});
 for(const workflow of ["ants","permis"]){
 // La date de naissance est obligatoire sur l'écran « Qui êtes-vous ? » : le profil « sans date » ne peut plus aboutir.
 for(const profile of ["majeur","mineur"]){
 const minor=profile==="mineur";
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
 page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 const a={...candidate,workflow,birthDate:minor?"2009-03-12":"2006-03-12",nationality:minor?"francaise":"etrangere",identityDocument:minor?"cni_fr":"sejour",emancipated:"non",special:minor?"oui":"non",specialReason:"medical",medical:minor?"oui":"non",home:minor?"parents":"own",homeProof:minor?"impot":"facture",identityExpiry:"",homeDate:minor?"2026-08":"2026-08",contactName:"Debbie Exemple",contactPhone:"0600000001",contactEmail:"debbie@example.test"};
 const path=stepsFor(a);
 let deferredKey="";
 await page.addInitScript(()=>{
 const nativeFetch=window.fetch;
 window.fetch=function(url,options){
 if(String(url).endsWith("/api/submit"))window.testPayload=JSON.parse(options.body.get("payload"));
 return nativeFetch.apply(this,arguments);
 };
 });
 await page.goto(h.url+"/"+workflow+".html");
 assert.equal(await page.locator('input[name="workflow"]').count(),0);
 assert.equal(await page.locator("#journey-title").innerText(),workflow==="ants"?"ANTS":"Permis");
 const choose=async(key,value)=>page.locator('input[name="'+key+'"][value="'+value+'"]').check();
 const title=()=>page.locator("h1").innerText();
 const waitTitle=async text=>page.waitForFunction(expected=>document.querySelector("h1")?.textContent===expected,text);
 const next=async expected=>{await page.locator("#next-button").click();await waitTitle(expected);};
 async function responsive(){
 for(const width of [320,390,768,1366]){
 await page.setViewportSize({width,height:900});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const boxes=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,car:document.querySelector("#progress-car").getBoundingClientRect().toJSON(),road:document.querySelector("#road").getBoundingClientRect().toJSON()}));
 assert.equal(boxes.overflow,false,"Débordement "+workflow+" "+width+" "+await title());
 assert.ok(boxes.car.x>=boxes.road.x-1&&boxes.car.right<=boxes.road.right+1,"Position voiture");
 }
 await page.setViewportSize({width:390,height:844});
 }
 const observed=[];
 for(let i=0;i<path.length-1;i++){
 const s=path[i];await waitTitle(s.title);observed.push(s.id);
 if(s.id==="identity"){
 // Écran regroupé : nom de naissance, prénom et date de naissance. Entrée sur un champ vide affiche l'erreur sans changer d'écran.
 await page.locator("#field-birthName").press("Enter");
 assert.equal(await page.locator("#birthName-error").isVisible(),true);
 assert.equal(await title(),s.title);
 }
 if(s.id==="coordinates"){
 await page.locator(".back-button").press("Enter");await waitTitle(path[0].title);
 assert.equal(await page.locator("#field-birthName").inputValue(),"GRAYSON");
 assert.equal(await page.locator("#field-birthDate").inputValue(),dateInputValue(a.birthDate));
 await next(s.title);
 }
 for(const f of s.fields){
 if(f.type==="choice")await choose(f.key,a[f.key]);
 else if(["birthdate","date","month"].includes(f.type)){
 const input=page.locator("#field-"+f.key);
 assert.equal(await input.getAttribute("type"),"text");assert.equal(await input.getAttribute("required"),f.type==="birthdate"?"":null);
 const picker=page.locator("#field-"+f.key+"-calendar");
 assert.equal(await picker.getAttribute("type"),f.type==="month"?"month":"date");
 if(f.type==="birthdate"){
 await input.pressSequentially("19");assert.equal(await input.inputValue(),"19/");
 await input.pressSequentially("12");assert.equal(await input.inputValue(),"19/12/");
 await input.pressSequentially("2004");assert.equal(await input.inputValue(),"19/12/2004");
 await input.press("Control+A");await input.press("Backspace");assert.equal(await input.inputValue(),"");
 await input.pressSequentially("19");await input.press("Backspace");assert.equal(await input.inputValue(),"1");
 await input.fill("");
 assert.equal(await page.locator("#next-button").isDisabled(),true,"date de naissance obligatoire");
 await input.pressSequentially("31/02/2006");
 await input.press("Enter");assert.equal(await title(),s.title);assert.equal(await page.locator("#birthDate-error").isVisible(),true);
 await input.fill("");
 await input.pressSequentially("12/03/2999");assert.equal(await page.locator("#next-button").isDisabled(),true);
 await input.fill("");
 }
 await input.pressSequentially(dateInputValue(a[f.key],f.type==="month"?"month":"date"));
 if(f.key==="birthDate")assert.ok((await page.locator(".date-feedback").first().innerText()).includes("Votre âge calculé : "+(minor?17:20)+" ans"));
 if(f.key==="identityExpiry"){
 await picker.evaluate(n=>{const show=n.showPicker.bind(n);n.showPicker=()=>{n.dataset.calls=String(Number(n.dataset.calls||0)+1);show();};});
 await input.click();assert.equal(await picker.getAttribute("data-calls"),null);
 await picker.click();assert.equal(await picker.getAttribute("data-calls"),"1");await page.keyboard.press("Escape");
 await picker.fill("2030-05-12");await picker.dispatchEvent("change");
 assert.equal(await input.inputValue(),"12/05/2030");
 await picker.press("Enter");assert.equal(await title(),s.title);
 await input.fill("");await input.pressSequentially("01/01/2020");
 assert.ok((await page.locator(".date-feedback").innerText()).includes("Expiré"));
 await input.fill("");await input.pressSequentially("12052030");
 assert.ok((await page.locator(".date-feedback").innerText()).includes("Validité restante"));
 await page.screenshot({path:"test-results/"+workflow+"-"+profile+"-validite.png",fullPage:true});
 await input.fill("");assert.equal(await page.locator("#identityExpiry-error").isVisible(),false);
 }
 if(f.key==="homeDate"){
 assert.equal(await input.getAttribute("placeholder"),"MM/AAAA");
 await input.pressSequentially("08");assert.equal(await input.inputValue(),"08/");await input.pressSequentially("2026");assert.equal(await picker.inputValue(),"2026-08");
 a.homeDate="2026-08";
 }
 }else{
 await page.locator("#field-"+f.key).fill(a[f.key]||"");
 if(f.key==="phone"){
 await page.locator("#field-phone").press("Enter");
 assert.equal(await title(),s.title);assert.equal(await page.locator("#email-error").isVisible(),true);
 }
 }
 }
 if(s.id==="identityDocument"){
 assert.deepEqual(await page.locator('input[name="identityDocument"]').evaluateAll(ns=>ns.map(n=>n.value)),minor?["cni_fr","passeport_fr"]:["sejour","cni_europe","passeport_etranger"]);
 }
 if(s.id==="identityFiles"){
 const date=page.locator("#field-identityExpiry");
 await date.press("Enter");assert.equal(await title(),s.title);
 assert.equal(await page.locator("#documents-required-error").isVisible(),true);
 assert.equal(await page.locator(".defer-choice").count(),0,"le document d’identité n’est jamais différable");
 await page.locator('input[type="file"]').setInputFiles([{name:"IMG_4827.HEIC",mimeType:"image/heic",buffer:heic},{name:"recto été.png",mimeType:"image/png",buffer:png}]);
 assert.equal(await page.locator(".file-row").count(),2);
 await page.locator(".file-remove").first().click();assert.equal(await page.locator(".file-row").count(),1);
 if(workflow==="ants"&&minor){
 const before=await page.locator(".file-row").count(),large=Buffer.alloc(9*1024*1024);pdf.copy(large);
 await page.locator('input[type="file"]').setInputFiles([{name:"grand1.pdf",mimeType:"application/pdf",buffer:large},{name:"grand2.pdf",mimeType:"application/pdf",buffer:large}]);
 assert.equal(await page.locator(".file-row").count(),before);
 assert.ok((await page.locator(".upload-card .field-error").innerText()).includes("dépasse"));
 }
 }
 if(s.id==="home"){assert.equal(await title(),"Quelle est votre situation ?");}
 if(s.id==="ageFiles"){
 assert.deepEqual(await page.locator('input[type="file"]').evaluateAll(ns=>ns.map(n=>n.id)),minor?["upload-assr_2","upload-recensement"]:["upload-assr_2"]);
 assert.equal(await page.locator("#next-button").isDisabled(),true,"pièce d’âge obligatoire sans fichier ni report");
 // Report d'une pièce : #defer-jdc si la JDC est attendue (Français de 18 à 25 ans), sinon la première case de report disponible.
 const deferIds=await page.locator(".defer-choice input").evaluateAll(ns=>ns.map(n=>n.id));
 const deferId=deferIds.includes("defer-jdc")?"defer-jdc":deferIds[0];
 assert.ok(deferId,"case de report disponible sur l’étape ageFiles");
 deferredKey=deferId.slice("defer-".length);a.deferred=[deferredKey];
 const card=page.locator(".upload-card").filter({has:page.locator("#"+deferId)});
 await page.locator("#"+deferId).check();
 assert.ok(await card.evaluate(n=>n.classList.contains("deferred")));
 assert.ok((await card.locator(".file-status").innerText()).includes("Non fournie — AEM vous recontactera"));
 if(!minor)assert.equal(await page.locator("#next-button").isEnabled(),true,"le report lève le blocage");
 }
 if(s.id==="permitFiles")assert.equal(await page.locator("#next-button").isDisabled(),true);
 if(s.documentGroup&&s.id!=="identityFiles"){
 const inputs=page.locator('input[type="file"]');
 for(let n=0;n<await inputs.count();n++){
 const input=inputs.nth(n);
 if(await input.getAttribute("id")==="upload-"+deferredKey)continue; // ajouter un fichier annulerait le report
 await input.setInputFiles({name:s.id+"-"+n+".pdf",mimeType:"application/pdf",buffer:pdf});
 }
 }
 assert.equal(await page.locator("#next-button").isEnabled(),true,s.id+" : dates vides autorisées");
 await responsive();
 if(s.id==="homeFiles")await page.screenshot({path:"test-results/"+workflow+"-"+profile+"-mobile.png",fullPage:true});
 const text=page.locator('input[type="text"],input[type="email"],input[type="tel"]').first();
 if(await text.count()){await text.press("Enter");await waitTitle(path[i+1].title);}
 else await next(path[i+1].title);
 }
 const expectedStart=["identity","coordinates","nationality",...(minor&&workflow==="permis"?["emancipation"]:[]),"identityDocument","identityFiles","ageFiles"];
 assert.deepEqual(observed.slice(0,expectedStart.length),expectedStart);
 assert.equal(observed.includes("contact"),minor);assert.ok(observed.includes("ageFiles"));
 await responsive();
 assert.ok((await page.locator(".summary-panel").innerText()).includes("Non fournie — AEM vous recontactera"),"pièce différée signalée dans le récapitulatif");
 const identitySummary=page.locator(".summary-group").filter({has:page.getByRole("heading",{name:"Ajoutez votre document d’identité",exact:true})});
 await identitySummary.getByRole("button",{name:"Modifier",exact:true}).press("Enter");
 await waitTitle("Ajoutez votre document d’identité");assert.equal(await page.locator(".file-row").count(),1);
 await page.locator("#field-identityExpiry").press("Enter");await waitTitle("Vérifiez votre récapitulatif");
 if(minor&&workflow==="ants"){
 const section=page.locator(".summary-group").filter({has:page.getByRole("heading",{name:"Qui êtes-vous ?",exact:true})});
 await section.getByRole("button",{name:"Modifier",exact:true}).click();
 await page.locator("#field-birthDate").fill("12/03/2000");a.birthDate="2000-03-12";delete a.deferred; // devenu majeur : plus de pièce d'âge, le report disparaît
 await page.locator("#field-birthDate").press("Enter");await waitTitle("Vérifiez votre récapitulatif");
 assert.ok(!(await page.locator(".summary-panel").innerText()).includes("Debbie Exemple"));
 assert.ok(!(await page.locator(".summary-panel").innerText()).includes("ageFiles-"));
 assert.ok(!(await page.locator(".summary-panel").innerText()).includes("AEM vous recontactera"));
 }
 await page.locator("#send-confirm").check();await page.locator("#send-button").click();
 await waitTitle("Votre envoi a été pris en charge");
 const successText=await page.locator("#question-card").innerText();
 const payload=await page.evaluate(()=>window.testPayload);
 const deferredLabels=(a.deferred||[]).map(key=>documentsFor(a).find(d=>d.key===key).label);
 const mail=h.messages.at(-1);assert.equal(mail.subject,subjectFor(a));
 assert.ok(mail.text.includes("Nouveau dossier arrivé dans la zone admin"),"notification sans pièces jointes (AEM_MAIL_ATTACHMENTS=0)");
 assert.equal(mail.text.includes("Pièces à récupérer"),deferredLabels.length>0);
 assert.equal(successText.includes("AEM vous recontactera pour récupérer"),deferredLabels.length>0);
 for(const label of deferredLabels){assert.ok(mail.text.includes(label));assert.ok(successText.includes(label));}
 const meta=JSON.parse(await readFile(h.dataDir+"/"+payload.submissionId+"/meta.json","utf8"));
 assert.ok(meta.auditText.includes("DOCUMENTS TRANSMIS"));
 assert.equal(meta.auditText.includes("PIÈCES À RÉCUPÉRER PAR AEM"),deferredLabels.length>0);
 assert.equal(meta.incomplete,deferredLabels.length>0);
 const stored=meta.files.find(f=>f.name==="recto été.png");assert.ok(stored,"nom de fichier d’origine conservé");
 assert.deepEqual(await readFile(h.dataDir+"/"+payload.submissionId+"/files/"+stored.storedAs),png);
 const meaningful=obj=>Object.fromEntries(Object.entries(obj).filter(([,value])=>value!==""));
 assert.deepEqual(meaningful(payload.answers),meaningful(cleanAnswers(a)));
 assert.ok(Object.keys(payload.answers).every(key=>Object.hasOwn(cleanAnswers(a),key)));
 assert.equal(meta.auditText.includes("PERSONNE À CONTACTER"),minor&&workflow==="permis");
 const expectedDocs=documentsFor(a).map(d=>d.key);assert.ok(payload.files.every(f=>expectedDocs.includes(f.key)));
 assert.ok(!payload.files.some(f=>(a.deferred||[]).includes(f.key)),"aucun fichier pour une pièce différée");
 results.push(workflow+" "+profile+" : parcours, dates clavier/calendrier, fichiers, pièce différée, SMTP local, 4 largeurs OK");
 await page.close();
 }
 }
 const page=await browser.newPage({reducedMotion:"reduce"});page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await page.route("**/api/config",r=>r.fulfill({status:404,body:"Not found"}));
 let attempts=0;await page.route("**/api/submit",r=>{attempts++;return r.abort();});
 await page.goto(h.url+"/ants.html");
 const a={...candidate,home:"own",birthDate:"1990-01-01",identityExpiry:"",homeDate:""}; // 36 ans : aucune pièce liée à l'âge
 for(const s of stepsFor(a).filter(s=>s.id!=="summary")){
 await page.getByRole("heading",{name:s.title,exact:true}).waitFor();
 for(const f of s.fields){
 if(f.type==="choice")await page.locator('input[name="'+f.key+'"][value="'+a[f.key]+'"]').check();
 else await page.locator("#field-"+f.key).fill(["birthdate","date","month"].includes(f.type)?dateInputValue(a[f.key]||"",f.type==="month"?"month":"date"):a[f.key]||"");
 }
 if(s.documentGroup){
 const inputs=page.locator('input[type="file"]');
 for(let n=0;n<await inputs.count();n++)await inputs.nth(n).setInputFiles({name:s.id+"-"+n+".pdf",mimeType:"application/pdf",buffer:pdf});
 }
 await page.locator("#next-button").click();
 }
 await page.locator("#send-confirm").check();assert.equal(await page.locator("#send-button").isDisabled(),true);
 assert.ok((await page.locator("#send-availability").innerText()).includes("aucun audit ni document"));
 assert.equal(attempts,0);await page.close();
 results.push("Site statique sans API : aucun faux envoi");
 for(const file of ["app.js","logic.js","ants.html","permis.html"]){
 const source=await readFile(file,"utf8");assert.ok(!/[\uFFFD]|[ÃÂ][\u0080-\u00bf]|R\?ponse|compl\?ter/.test(source),"Encodage "+file);
 }
 assert.equal(limits.totalBytes,17*1024*1024);assert.deepEqual(errors,[]);
 await writeFile("test-results/browser-results.json",JSON.stringify({results,javascriptErrors:errors},null,2));
 console.log(results.join("\n"));console.log("Aucune erreur JavaScript.");
}finally{await browser?.close();await h.close();}
