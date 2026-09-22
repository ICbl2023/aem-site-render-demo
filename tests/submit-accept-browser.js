import {chromium} from "playwright";
import assert from "node:assert/strict";
import {mkdir,readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {createApp} from "../server.js";
import {png,pdf,candidate} from "./helpers.js";
import {stepsFor,dateInputValue} from "../logic.js";

const dataDir=path.resolve("test-results","submit-accept-browser-"+crypto.randomUUID());
const receiptDir=dataDir+"-receipts";
await mkdir(dataDir,{recursive:true});await mkdir(receiptDir,{recursive:true});
const origin="http://127.0.0.1:4181";
let mails=0;
const app=createApp({config:{origin,from:"aem@example.test",recipient:"admin@example.test",receiptDir,dataDir,adminPassword:"test-admin",candidateMail:false,retentionDays:0},transport:{async sendMail(){mails++;throw new Error("SMTP failure");}}});
await new Promise(r=>app.listen(4181,"127.0.0.1",r));
const url="http://127.0.0.1:4181";
let browser;
try{
 await mkdir("test-results",{recursive:true});
 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
 const a={...candidate,workflow:"ants",birthDate:"1990-01-01",nationality:"francaise",identityDocument:"cni_fr",special:"non",home:"own",homeProof:"facture",identityExpiry:"",homeDate:"2026-08"};
 await page.goto(url+"/ants.html");
 await page.getByRole("button",{name:"Commencer mon dossier",exact:true}).click();
 for(const s of stepsFor(a).filter(s=>s.id!=="summary")){
  await page.waitForFunction(t=>document.querySelector("h1")?.textContent===t,s.title);
  for(const f of s.fields){
   if(f.type==="choice")await page.locator('label.choice-card:has(input[name="'+f.key+'"][value="'+a[f.key]+'"])').click();
   else if(["birthdate","date","month"].includes(f.type))await page.locator("#field-"+f.key).fill(dateInputValue(a[f.key]||"",f.type==="month"?"month":"date"));
   else await page.locator("#field-"+f.key).fill(a[f.key]||"");
  }
  if(s.documentGroup){
   const inputs=page.locator('input[type="file"][id^="upload-"]');
   if(s.id==="identityFiles")await inputs.first().setInputFiles([{name:"recto.png",mimeType:"image/png",buffer:png},{name:"verso.png",mimeType:"image/png",buffer:png}]);
   else for(let n=0;n<await inputs.count();n++)await inputs.nth(n).setInputFiles({name:s.id+"-"+n+".pdf",mimeType:"application/pdf",buffer:pdf});
  }
  await page.locator("#next-button").click();
 }
 await page.locator("#send-confirm").check();
 await page.locator("#send-button").click();
 await page.waitForFunction(()=>document.querySelector("h1")?.textContent==="Votre dossier est bien enregistré",null,{timeout:30000});
 const text=await page.locator("#question-card").innerText();
 assert.match(text,/n['’]avez pas à recommencer/);
 assert.ok(text.includes("Référence :"));
 assert.ok(!/Réessayer l['’]envoi/.test(text));
 const folders=(await readdir(dataDir,{withFileTypes:true})).filter(d=>d.isDirectory() && /^[a-f0-9-]{36}$/i.test(d.name));
 assert.equal(folders.length,1);
 const meta=JSON.parse(await readFile(dataDir+"/"+folders[0].name+"/meta.json","utf8"));
 assert.equal(meta.adminNotify,"failed");
 assert.ok(mails>=1,"SMTP a bien été tenté");
 console.log("submit-accept-browser OK : confirmation candidat malgré échec SMTP (adminNotify=failed)");
}finally{
 if(browser)await browser.close();
 await new Promise(r=>app.close(r));
}
