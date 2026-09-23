import {chromium} from "playwright";
import assert from "node:assert/strict";
import {writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {startHarness,pdf,png} from "./helpers.js";
import {stepsFor,documentsFor} from "../logic.js";

const h=await startHarness({port:4188});
let browser;
try{
 await mkdir("test-results",{recursive:true});
 await writeFile(path.resolve("test-results","card-dnd.pdf"),pdf);
 await writeFile(path.resolve("test-results","card-dnd.png"),png);

 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const page=await browser.newPage();
 const choose=async(key,value)=>{await page.locator("label.choice-card").filter({has:page.locator('input[name="'+key+'"][value="'+value+'"]')}).click();};
 const next=async()=>{await page.locator("#next-button").click();};

 // Accueil Permis : phrase et CEPC retires.
 await page.goto(h.url+"/permis.html");
 const welcome=await page.locator(".welcome-content").innerText();
 assert.ok(!/fabrication ou le renouvellement/i.test(welcome));
 assert.ok(!/CEPC/i.test(welcome));
 assert.ok(!/certificat d.examen/i.test(welcome));

 const pathIds=stepsFor({workflow:"permis",birthDate:"2009-03-12",nationality:"francaise",medical:"non"}).map(s=>s.id);
 assert.ok(!pathIds.includes("emancipation"));
 assert.ok(!pathIds.includes("permitType"));
 assert.ok(!pathIds.includes("permitFiles"));
 assert.ok(!documentsFor({workflow:"permis",medical:"non",nationality:"francaise",identityDocument:"cni_fr",home:"own"}).some(d=>/permit_/.test(d.key)));

 await page.goto(h.url+"/ants.html");
 await page.getByRole("button",{name:/Commencer mon dossier/i}).click();
 await page.waitForSelector("#field-birthName");
 await page.fill("#field-birthName","TEST");
 await page.fill("#field-firstName","Drop");
 await page.fill("#field-birthDate","12/03/2006");
 await next();
 await page.waitForSelector("#field-phone");
 await page.fill("#field-phone","0600000000");
 await page.fill("#field-email","drop@example.test");
 await next();
 await page.waitForSelector('input[name="nationality"]');
 await choose("nationality","francaise");
 await next();
 await page.waitForSelector('input[name="identityDocument"]');
 await choose("identityDocument","cni_fr");
 await next();
 await page.waitForSelector(".document-card");

 const idCard=page.locator(".document-card").first();
 await idCard.evaluate((el,bytes)=>{
  const file=new File([new Uint8Array(bytes)],"cni-drop.pdf",{type:"application/pdf"});
  const dt=new DataTransfer();dt.items.add(file);
  for(const type of ["dragenter","dragover","drop"])el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
 },[...pdf]);
 await page.waitForTimeout(200);
 assert.ok((await idCard.locator(".file-row").count())>=1,"PDF sur carte identite");

 await page.fill("#field-identityExpiry","12/05/2030");
 await next();
 await page.waitForSelector(".document-card");
 const assr=page.locator(".document-card").filter({hasText:/ASSR 2/i}).first();
 await assr.waitFor({state:"visible"});
 await assr.locator("h2").evaluate((el,bytes)=>{
  const file=new File([new Uint8Array(bytes)],"assr2-drop.png",{type:"image/png"});
  const dt=new DataTransfer();dt.items.add(file);
  for(const type of ["dragenter","dragover","drop"])el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
 },[...png]);
 await page.waitForTimeout(200);
 assert.ok((await assr.locator(".file-row").count())>=1,"PNG ASSR sur bonne carte");

 await assr.evaluate(el=>{
  const file=new File([new Uint8Array([1,2,3])],"virus.exe",{type:"application/octet-stream"});
  const dt=new DataTransfer();dt.items.add(file);
  el.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));
 });
 await page.waitForTimeout(100);
 const err=assr.locator(".field-error");
 assert.equal(await err.isVisible(),true);
 assert.match(await err.innerText(),/Format non accepté/i);

 console.log("document-dnd-browser OK permis-simplified+card-drop-synthetic");
}finally{
 if(browser)await browser.close();
 await h.close();
}
