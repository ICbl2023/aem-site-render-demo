import {chromium} from "playwright";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {startHarness,form,send,candidate,attachmentsFor,pdf} from "./helpers.js";

const h=await startHarness({port:4177});
let browser;
try{
 await mkdir("test-results",{recursive:true});
 const answers={...candidate,deferred:["jdc"]};
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(answers,attachmentsFor(answers).filter(f=>f.key!=="jdc"),id))).status,200);
 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const page=await browser.newPage();
 await page.goto(h.url+"/admin.html?dossier="+id);
 await page.fill("#admin-user","admin");
 await page.fill("#admin-password","test-admin");
 await page.click('button[type="submit"]');
 await page.waitForSelector(".admin-piece",{timeout:20000});
 const piece=page.locator(".admin-piece").filter({hasText:/JDC/i}).first();
 await piece.waitFor({state:"visible",timeout:20000});
 const target=piece.locator(".admin-upload");
 await target.evaluate(el=>{
  const dt=new DataTransfer();
  el.dispatchEvent(new DragEvent("dragenter",{bubbles:true,cancelable:true,dataTransfer:dt}));
  el.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:dt}));
 });
 assert.equal(await target.evaluate(el=>el.classList.contains("is-dragover")),true,"zone DnD JDC active au dragover");

 const pdfPath=path.resolve("test-results/dnd-a.pdf");
 await writeFile(pdfPath,pdf);
 const [resp]=await Promise.all([
  page.waitForResponse(r=>r.url().includes("/api/admin/dossiers/") && r.url().includes("/files") && r.request().method()==="POST",{timeout:20000}),
  target.locator('input[type="file"]').setInputFiles(pdfPath)
 ]);
 assert.equal(resp.status(),200,"PDF depose via le meme sendFiles que le drop");
 await page.waitForTimeout(400);
 const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
 const jdc=(meta.files||[]).filter(f=>f.key==="jdc" && f.source==="comptoir");
 assert.equal(jdc.length,1);
 assert.match(jdc[0].originalName||jdc[0].name,/\.pdf$/i);
 console.log("admin-dnd-browser OK deepLink+dragover+pdf");
}finally{
 if(browser)await browser.close();
 await h.close();
}
