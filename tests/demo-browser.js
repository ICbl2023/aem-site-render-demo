import assert from "node:assert/strict";
import {chromium} from "playwright";
import {createApp} from "../server.js";
import {candidate,png,pdf,heic} from "./helpers.js";
import {stepsFor,dateInputValue,auditText,cleanAnswers} from "../logic.js";
import {mkdir} from "node:fs/promises";
const origin="http://127.0.0.1:4180";let sends=0;
const app=createApp({demo:true,config:{origin},transport:{sendMail(){sends++;throw Error("SMTP interdit");}}});
await new Promise(r=>app.listen(4180,"127.0.0.1",r));
let browser;const errors=[];
try{
browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
await mkdir("test-results",{recursive:true});
for(const workflow of ["ants","permis"]){
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
page.on("pageerror",e=>errors.push(e.message));
const a={...candidate,workflow,home:"own",identityExpiry:"",homeDate:"",medical:"non"};
await page.goto(origin+"/"+workflow+".html");
const uploads=[];
for(const s of stepsFor(a).filter(s=>s.id!=="summary")){
await page.getByRole("heading",{name:s.title,exact:true}).waitFor();
for(const f of s.fields){
if(f.type==="choice")await page.locator('input[name="'+f.key+'"][value="'+a[f.key]+'"]').check();
else await page.locator("#field-"+f.key).fill(["birthdate","date","month"].includes(f.type)?dateInputValue(a[f.key],f.type==="month"?"month":"date"):a[f.key]||"");
}
if(s.documentGroup){
for(const input of await page.locator('input[type="file"]').all()){
const key=(await input.getAttribute("id")).replace("upload-","");
const files=s.id==="identityFiles"?[{name:"recto été.png",mimeType:"image/png",buffer:png},{name:"IMG_4827.HEIC",mimeType:"image/heic",buffer:heic}]:[{name:key+".pdf",mimeType:"application/pdf",buffer:pdf}];
await input.setInputFiles(files);
uploads.push(...files.map(f=>({key,name:f.name,size:f.buffer.length,content:f.buffer,contentType:f.mimeType})));
}
}
await page.locator("#next-button").click();
}
await page.locator("#send-confirm").check();
await page.locator("#send-button").click();
await page.waitForURL("**/test-audit/*");
assert.equal(await page.locator("h1").innerText(),"Aperçu de l’audit administratif");
assert.ok((await page.locator(".candidate-info").innerText()).includes("nolan@example.test"));
assert.ok((await page.locator(".eyebrow").textContent()).includes(workflow==="ants"?"Dossier ANTS":"Fabrication du permis"));
const text=await page.locator("#audit-body").textContent();
assert.equal(text.split("\n\nRéférence de transmission : ")[0],auditText(cleanAnswers(a),uploads));
assert.equal(await page.locator(".demo-files li").count(),uploads.length);
assert.ok((await page.locator(".demo-document-group").first().innerText()).includes("2 fichier(s)"));
const links=await page.locator('.demo-files a:has-text("Télécharger")').evaluateAll(ns=>ns.map(n=>n.href));
for(let i=0;i<links.length;i++){
const res=await fetch(links[i]);assert.equal(res.status,200);
assert.deepEqual(Buffer.from(await res.arrayBuffer()),uploads[i].content);
assert.ok(res.headers.get("content-disposition").includes(encodeURIComponent(uploads[i].name)));
}
for(const width of [320,768,1366]){
await page.setViewportSize({width,height:900});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:"test-results/demo-"+workflow+"-"+width+".png",fullPage:true});
}
console.log(workflow+" : parcours complet, redirection, audit identique, fichiers originaux téléchargeables, 3 largeurs OK");
await page.close();
}
assert.equal(sends,0);assert.deepEqual(errors,[]);
console.log("Aucun appel SMTP, aucun email réel, aucune erreur JavaScript.");
}finally{await browser?.close();await new Promise(r=>app.close(r));}

