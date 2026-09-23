import {chromium} from "playwright";
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import path from "node:path";
import {startHarness,form,send,candidate,attachmentsFor,pdf,png} from "./helpers.js";

const h=await startHarness({port:4177});
let browser;
try{
 await mkdir("test-results",{recursive:true});
 const pdfPath=path.resolve("test-results","dnd-a.pdf");
 const pngPath=path.resolve("test-results","dnd-b.png");
 await writeFile(pdfPath,pdf);
 await writeFile(pngPath,png);

 const answers={...candidate,deferred:["jdc"]};
 const id=crypto.randomUUID();
 assert.equal((await send(h,form(answers,attachmentsFor(answers).filter(f=>f.key!=="jdc"),id))).status,200);

 browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 const page=await browser.newPage();

 async function loginAndOpenJdc(){
  await page.goto(h.url+"/admin.html?dossier="+id);
  if(await page.locator("#admin-user").isVisible().catch(()=>false)){
   await page.fill("#admin-user","admin");
   await page.fill("#admin-password","test-admin");
   await page.click('button[type="submit"]');
  }
  await page.waitForSelector(".admin-piece",{timeout:20000});
  const piece=page.locator(".admin-piece").filter({hasText:/JDC/i}).first();
  await piece.waitFor({state:"visible",timeout:20000});
  const zone=piece.locator(".admin-dropzone");
  await zone.waitFor({state:"visible",timeout:20000});
  return {piece,zone};
 }

 const {zone}=await loginAndOpenJdc();

 const box=await zone.boundingBox();
 assert.ok(box,"zone boundingBox");
 assert.ok(box.width>=240,"dropzone width >= 240, got "+box.width);
 assert.ok(box.height>=90,"dropzone height >= 90, got "+box.height);

 assert.match(await zone.innerText(),/Glissez-déposez vos fichiers ici/);
 assert.equal(await zone.locator(".admin-upload-pick").count(),1);
 assert.equal(await zone.locator('input[type="file"]').count(),1);

 await zone.evaluate(el=>{
  const dt={types:["Files"],files:{length:0,item:()=>null},items:{length:0},dropEffect:"none",effectAllowed:"all",setData(){},getData(){return"";},clearData(){},setDragImage(){}};
  for(const type of ["dragenter","dragover"]){
   const e=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperty(e,"dataTransfer",{configurable:true,value:dt});
   el.dispatchEvent(e);
  }
 });
 assert.equal(await zone.evaluate(el=>el.classList.contains("is-dragover")),true,"is-dragover after zone dragenter/dragover");
 await zone.scrollIntoViewIfNeeded();
 await zone.screenshot({path:"test-results/admin-dnd-dragover-synthetic.png"});

 await zone.locator(".admin-dropzone-hint").evaluate(hint=>{
  const dt={types:["Files"],files:{length:0,item:()=>null},items:{length:0},dropEffect:"none",effectAllowed:"all",setData(){},getData(){return"";},clearData(){},setDragImage(){}};
  for(const type of ["dragenter","dragover"]){
   const e=new Event(type,{bubbles:true,cancelable:true});
   Object.defineProperty(e,"dataTransfer",{configurable:true,value:dt});
   hint.dispatchEvent(e);
  }
 });
 assert.equal(await zone.evaluate(el=>el.classList.contains("is-dragover")),true,"is-dragover after hint dragenter/dragover");

 await zone.evaluate(el=>{
  const dt={types:["Files"],files:{length:0,item:()=>null},items:{length:0},dropEffect:"none",effectAllowed:"all",setData(){},getData(){return"";},clearData(){},setDragImage(){}};
  for(let i=0;i<2;i++){
   const e=new Event("dragleave",{bubbles:true,cancelable:true});
   Object.defineProperty(e,"dataTransfer",{configurable:true,value:dt});
   el.dispatchEvent(e);
  }
 });
 assert.equal(await zone.evaluate(el=>el.classList.contains("is-dragover")),false,"is-dragover cleared after two dragleave");

 async function dropFile(locator,{filePath,name,mimeType,viaChild=false}={}){
  const buf=await readFile(filePath);
  const bytes=[...buf];
  const [resp]=await Promise.all([
   page.waitForResponse(r=>r.url().includes("/api/admin/dossiers/") && r.url().includes("/files") && r.request().method()==="POST",{timeout:20000}),
   locator.evaluate((el,{bytes,name,mimeType,viaChild})=>{
    const target=viaChild?(el.querySelector(".admin-dropzone-hint")||el):el;
    const file=new File([new Uint8Array(bytes)],name,{type:mimeType});
    const dt=new DataTransfer();
    dt.items.add(file);
    for(const type of ["dragenter","dragover","drop"]){
     target.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
    }
   },{bytes,name,mimeType,viaChild})
  ]);
  assert.equal(resp.status(),200,"POST /files after drop "+name);
  return resp;
 }

 await dropFile(zone,{filePath:pdfPath,name:"jdc-dnd.pdf",mimeType:"application/pdf"});
 await page.waitForTimeout(500);

 const zone2=page.locator(".admin-piece").filter({hasText:/JDC/i}).first().locator(".admin-dropzone");
 await zone2.waitFor({state:"visible",timeout:20000});
 await dropFile(zone2,{filePath:pngPath,name:"jdc-dnd.png",mimeType:"image/png",viaChild:true});
 await page.waitForTimeout(500);

 const zone3=page.locator(".admin-piece").filter({hasText:/JDC/i}).first().locator(".admin-dropzone");
 await zone3.waitFor({state:"visible",timeout:20000});
 const [classicResp]=await Promise.all([
  page.waitForResponse(r=>r.url().includes("/api/admin/dossiers/") && r.url().includes("/files") && r.request().method()==="POST",{timeout:20000}),
  zone3.locator('input[type="file"]').setInputFiles(pdfPath)
 ]);
 assert.equal(classicResp.status(),200,"classic setInputFiles PDF");
 await page.waitForTimeout(400);

 await page.goto(h.url+"/admin.html?dossier="+id);
 if(await page.locator("#admin-user").isVisible().catch(()=>false)){
  await page.fill("#admin-user","admin");
  await page.fill("#admin-password","test-admin");
  await page.click('button[type="submit"]');
 }
 await page.waitForSelector(".admin-dropzone",{timeout:20000});
 const zone4=page.locator(".admin-piece").filter({hasText:/JDC/i}).first().locator(".admin-dropzone");
 await zone4.waitFor({state:"visible",timeout:20000});
 const posts=[];
 const onReq=req=>{
  if(req.method()==="POST" && /\/files(?:\?|$)/.test(req.url()))posts.push(req.url());
 };
 page.on("request",onReq);
 await dropFile(zone4,{filePath:pdfPath,name:"jdc-once.pdf",mimeType:"application/pdf"});
 await page.waitForTimeout(600);
 page.off("request",onReq);
 assert.equal(posts.length,1,"exactly 1 POST /files after reopen drop, got "+posts.length);

 const meta=JSON.parse(await readFile(h.dataDir+"/"+id+"/meta.json","utf8"));
 const jdc=(meta.files||[]).filter(f=>f.key==="jdc" && f.source==="comptoir");
 assert.ok(jdc.length>=1,"meta.json has jdc comptoir files, got "+jdc.length);
 assert.ok(jdc.some(f=>/\.pdf$/i.test(f.originalName||f.name||"")),"at least one jdc pdf");
 assert.ok(jdc.some(f=>/\.png$/i.test(f.originalName||f.name||"")),"at least one jdc png");

 const zoneFinal=page.locator(".admin-piece").filter({hasText:/JDC/i}).first().locator(".admin-dropzone");
 await zoneFinal.scrollIntoViewIfNeeded();
 await zoneFinal.screenshot({path:"test-results/admin-dnd-after.png"});
 await page.screenshot({path:"test-results/admin-dnd-after-full.png",fullPage:false});
 console.log("admin-dnd-browser OK dropzone+synthetic+dropFile+classic+no-dup+meta");
}finally{
 if(browser)await browser.close();
 await h.close();
}
