import assert from "node:assert/strict";
import path from "node:path";
import {writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {startHarness,candidate,pdf,png,heic} from "./helpers.js";
import {stepsFor,subjectFor,dateInputValue} from "../logic.js";
import {webkitLaunchError,WEBKIT_SKIP_HINT} from "./webkit-available.js";
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(".browser-cache");
const {chromium,webkit,devices}=await import("playwright");
 const h=await startHarness({port:4174,mailAttachments:false}),results=[];
try{
 // Outil public test:mail contre un SMTP de laboratoire. Comportement réel : AEM_MAIL_ATTACHMENTS=0,
 // notification admin sans pièces jointes, fichiers uniquement dans l'espace admin.
 const probe=await new Promise(resolve=>{
 const child=spawn(process.execPath,["scripts/test-mail.js",h.url],{cwd:process.cwd(),stdio:["ignore","pipe","pipe"]});
 let output="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>output+=d);
 child.on("close",status=>resolve({status,output}));
 });
 assert.equal(probe.status,0,probe.output);
 assert.equal(h.messages.length,2);
 assert.ok(h.messages.every(m=>m.attachments.length===0),"la notification admin ne joint pas les pièces (AEM_MAIL_ATTACHMENTS=0)");
 assert.ok(h.messages.every(m=>m.text.includes("TEST-AEM") && m.text.includes("Nouveau dossier arrivé")));
 const login=await fetch(h.url+"/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Admin":"1",Origin:h.origin},body:JSON.stringify({password:"test-admin"})});
 assert.equal(login.status,200);
 const cookie=login.headers.get("set-cookie").split(";")[0];
 const list=await (await fetch(h.url+"/api/admin/dossiers",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).json();
 const items=list.dossiers||list.items||list;
 assert.ok(Array.isArray(items) && items.length>=2,"les deux dossiers TEST-AEM sont dans l’admin");
 for(const item of items.slice(0,2)){
  const detail=await (await fetch(h.url+"/api/admin/dossiers/"+item.id,{headers:{Cookie:cookie,"X-AEM-Admin":"1"}})).json();
  const dossier=detail.dossier||detail;
  assert.match(dossier.auditText||"",/TEST-AEM/);
  assert.ok((dossier.files||[]).length>=2,"les pièces sont stockées côté admin, pas dans le mail");
  const first=await fetch(h.url+"/api/admin/dossiers/"+item.id+"/files/0",{headers:{Cookie:cookie,"X-AEM-Admin":"1"}});
  assert.equal(first.status,200);
 }
 results.push("Outil test:mail : deux notifications sans pièces jointes ; les PDF sont dans l’espace admin, pas dans Gmail.");

 const webkitError=await webkitLaunchError();
 if(webkitError){
  results.push(WEBKIT_SKIP_HINT);
  console.log(WEBKIT_SKIP_HINT+"\nDétail Playwright : "+webkitError.split("\n")[0]);
 }
 const modes=["chrome-sans-api",...(webkitError?[]:["ipad-webkit","iphone-webkit"])];
 for(const mode of modes){
 const browser=mode==="chrome-sans-api"?await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true}):await webkit.launch({headless:true});
 try{
 for(const workflow of ["ants","permis"]){
 const options=mode==="ipad-webkit"?devices["iPad Mini"]:mode==="iphone-webkit"?devices["iPhone 13"]:{viewport:{width:390,height:844}};
 const page=await browser.newPage({...options,reducedMotion:"reduce"});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
 await page.addInitScript(()=>{
 Object.defineProperty(crypto,"randomUUID",{value:undefined,configurable:true});
 Object.defineProperty(Object,"hasOwn",{value:undefined,configurable:true});
 });
 const a={...candidate,workflow,birthDate:"2009-03-12",emancipated:"non",medical:"non",contactName:"Parent Exemple",contactPhone:"0600000001",contactEmail:"parent@example.test",identityExpiry:"",homeDate:"2026-08"};
 await page.goto(h.url+"/"+workflow+".html");
 await page.getByRole("button",{name:"Commencer mon dossier",exact:true}).click();
 for(const s of stepsFor(a).filter(s=>s.id!=="summary")){
 await page.waitForFunction(t=>document.querySelector("h1")?.textContent===t,s.title);
 for(const f of s.fields){
 if(f.type==="choice")await page.locator('label.choice-card:has(input[name="'+f.key+'"][value="'+a[f.key]+'"])').click();
 else if(["date","month","birthdate"].includes(f.type)){
 const field=page.locator("#field-"+f.key);
 if(f.type==="birthdate"){
 await field.pressSequentially("12");assert.equal(await field.inputValue(),"12/");
 await field.pressSequentially("03");assert.equal(await field.inputValue(),"12/03/");
 await field.pressSequentially("2009");assert.equal(await field.inputValue(),"12/03/2009");
 }else{
  assert.equal(await field.getAttribute("required"),f.required?"":null);
  if(a[f.key])await field.fill(dateInputValue(a[f.key],f.type==="month"?"month":"date"));
 }
 }else await page.locator("#field-"+f.key).fill(a[f.key]||"");
 }
 for(const input of await page.locator('input[type="file"][id^="upload-"]').all()){
 assert.equal(await input.getAttribute("capture"),null);
 assert.equal(await input.getAttribute("multiple"),"");
 assert.ok((await input.getAttribute("accept")).includes("image/*"));
 assert.ok((await input.getAttribute("accept")).includes("application/pdf"));
 await input.setInputFiles([{name:"test.png",mimeType:"image/png",buffer:png},{name:"test.HEIC",mimeType:"image/heic",buffer:heic},{name:"test.pdf",mimeType:"application/pdf",buffer:pdf}]);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+" "+s.id);
 if(s.id==="identityFiles")await page.screenshot({path:"test-results/"+mode+"-"+workflow+".png",fullPage:true});
 await page.locator("#next-button").click();
 }
 await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="Vérifiez votre récapitulatif");
 assert.ok((await page.locator(".summary-panel").innerText()).includes("Parent Exemple"));
 const group=page.locator(".summary-group").filter({has:page.getByRole("heading",{name:"Ajoutez votre document d’identité",exact:true})});
 await group.getByRole("button",{name:"Modifier",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="Ajoutez votre document d’identité");
 assert.equal(await page.locator(".file-row").count(),3);
 await page.locator("#field-identityExpiry").press("Enter");
 await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="Vérifiez votre récapitulatif");
 await page.locator("#send-confirm").check();await page.locator("#send-button").click();
 await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="Votre dossier est bien enregistré");
 const mail=h.messages.at(-1);assert.equal(mail.subject,"[AEM Admin] Nouveau dossier — "+subjectFor(a));
 assert.equal(mail.attachments.length,0,"notification admin sans pièces jointes");
 assert.deepEqual(errors,[]);await page.close();
 results.push(mode+" / "+workflow+" : rendu, dates, fichiers multiples, retour et envoi SMTP local OK (pièces dans l’admin).");
 }
 }finally{await browser.close();}
 }
 // Sans JavaScript : le message d'ouverture reste lisible (Chrome suffit ; WebKit n'est pas requis pour du HTML).
 const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 try{
 const page=await browser.newPage({javaScriptEnabled:false});
 await page.goto(h.url+"/ants.html");
 assert.ok((await page.locator("#question-card").innerText()).includes("Safari"));
 await page.close();results.push("Sans JavaScript : aide visible, carte non vide.");
 }finally{await browser.close();}
 await writeFile("test-results/compatibility-results.json",JSON.stringify({results,webkit:webkitError?"skipped":"ran"},null,2));
 console.log(results.join("\n"));
}finally{await h.close();}
