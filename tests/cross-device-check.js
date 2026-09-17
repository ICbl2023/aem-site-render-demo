// Reprise d'un appareil à l'autre, sur le paquet autonome et avec deux profils de navigateur distincts
// (donc deux IndexedDB et deux localStorage séparés, comme deux téléphones réels).
// Scénario : une candidate commence sur son téléphone, transmet son lien de reprise à un proche,
// qui rouvre le dossier depuis son propre téléphone et le complète.
import path from "node:path";
import {rm} from "node:fs/promises";
import {createApp} from "../questionnaires-autonomes/server.js";
process.env.PLAYWRIGHT_BROWSERS_PATH=path.resolve(".browser-cache");
const {chromium}=await import("playwright");
const origin="http://127.0.0.1:4196";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=","base64");
const app=createApp({config:{standalone:true,origin,dataDir:path.resolve("test-results/cross-data"),draftDir:path.resolve("test-results/cross-drafts"),receiptDir:path.resolve("test-results/cross-receipts"),adminAccounts:"t:t:responsable",candidateMail:false,aiEnabled:false,from:"",recipient:"",smtpHost:""}});
await new Promise(r=>app.listen(4196,"127.0.0.1",r));
const exe={headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"};
const profile=async name=>{
 const dir=path.resolve("test-results",name);
 await rm(dir,{recursive:true,force:true}).catch(()=>{});
 const context=await chromium.launchPersistentContext(dir,exe);
 return {context,page:context.pages()[0]||await context.newPage()};
};
const results={};
try{
 // 1. Le téléphone de la candidate : premières réponses, sauvegarde confirmée.
 const phone=await profile("cross-device-a");
 await phone.page.goto(origin+"/ants.html");
 await phone.page.getByRole("button",{name:"Commencer mon dossier"}).click();
 await phone.page.locator("#field-birthName").fill("TESTCROSS");
 await phone.page.locator("#field-firstName").fill("Marie");
 await phone.page.locator('.draft-bar[data-state="saved"]').waitFor({timeout:15000});
 results.savedOnPhone=await phone.page.evaluate(()=>({name:window.aemForm.answers().birthName,step:window.aemForm.state().id}));
 // Le lien de reprise tel qu'il serait copié, reçu par e-mail ou transmis par message.
 const resumeUrl=await phone.page.evaluate(()=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith("aem-draft-token:"));
  return key?location.origin+location.pathname+"#r="+localStorage.getItem(key):"";
 });
 results.resumeLinkIssued=Boolean(resumeUrl);
 await phone.context.close();

 // La photo est déposée après fermeture du téléphone : ainsi le flush de fermeture n'efface pas une pièce
 // absente du questionnaire (on est encore à l'étape identité). C'est le cas « pièce déjà sur le serveur ».
 const token=(resumeUrl.split("#r=")[1]||"").split("&")[0];
 const data=new FormData();
 data.append("key","identity_cni_fr");
 data.append("file_0",new Blob([png],{type:"image/png"}),"carte.png");
 const uploaded=await fetch(origin+"/api/draft/files",{method:"POST",headers:{"X-AEM-Request":"questionnaire",Origin:origin,"X-AEM-Draft":token},body:data});
 results.fileUploaded=uploaded.status;

 // 2. Un autre appareil SANS le lien : il ne doit rien voir. L'isolement d'origine reste intact.
 const stranger=await profile("cross-device-b");
 await stranger.page.goto(origin+"/ants.html");
 await stranger.page.getByRole("button",{name:"Commencer mon dossier"}).waitFor({timeout:15000});
 results.withoutLink=await stranger.page.evaluate(()=>({name:window.aemForm.answers().birthName||null,step:window.aemForm.state().id}));
 await stranger.context.close();

 // 3. Le téléphone du proche, avec le lien : les réponses sont là et il peut compléter le dossier.
 const relative=await profile("cross-device-c");
 await relative.page.goto(resumeUrl);
 await relative.page.locator('.draft-bar[data-state="saved"],.draft-bar[data-state="partial"]').waitFor({timeout:15000});
 results.withLink=await relative.page.evaluate(()=>({name:window.aemForm.answers().birthName||null,firstName:window.aemForm.answers().firstName||null,step:window.aemForm.state().id}));
 results.fileStatus=await relative.page.locator("#draft-status").innerText();
 results.fileOnRelative=await relative.page.evaluate(async()=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith("aem-draft-token:"));
  const token=localStorage.getItem(key);
  const draft=await(await fetch("./api/draft",{headers:{"X-AEM-Request":"questionnaire","X-AEM-Draft":token}})).json();
  const entry=draft.draft?.files?.[0];
  if(!entry)return {count:0};
  const file=await fetch("./api/draft/files/"+entry.index,{headers:{"X-AEM-Request":"questionnaire","X-AEM-Draft":token}});
  return {count:draft.draft.files.length,name:entry.name,size:(await file.arrayBuffer()).byteLength,status:file.status};
 });
 // Le proche corrige une réponse : la modification doit devenir visible pour la candidate.
 await relative.page.locator("#field-firstName").fill("Marie-Claire");
 await relative.page.locator('.draft-bar[data-state="saved"]').waitFor({timeout:15000});
 results.completedByRelative=await relative.page.evaluate(()=>window.aemForm.answers().firstName||null);
 await relative.context.close();

 // 4. La candidate reprend son propre téléphone : elle voit ce que le proche a ajouté.
 const phoneAgain=await profile("cross-device-d");
 await phoneAgain.page.goto(resumeUrl);
 await phoneAgain.page.locator('.draft-bar[data-state="saved"],.draft-bar[data-state="partial"]').waitFor({timeout:15000});
 results.backOnPhone=await phoneAgain.page.evaluate(()=>({name:window.aemForm.answers().birthName||null,firstName:window.aemForm.answers().firstName||null}));
 await phoneAgain.context.close();
}finally{
 await new Promise(r=>app.close(r));
}
const checks={
 sameDeviceWorks:results.savedOnPhone?.name==="TESTCROSS" && results.savedOnPhone?.step==="identity",
 resumeLinkIssued:results.resumeLinkIssued===true,
 isolatedWithoutLink:results.withoutLink?.name===null,
 crossDeviceWorks:results.withLink?.name==="TESTCROSS" && results.withLink?.firstName==="Marie",
 relativeCanComplete:results.completedByRelative==="Marie-Claire",
 changesVisibleBothWays:results.backOnPhone?.name==="TESTCROSS" && results.backOnPhone?.firstName==="Marie-Claire",
 fileFollowsLink:results.fileUploaded===200 && results.fileOnRelative?.status===200 && results.fileOnRelative?.size===png.length && results.fileOnRelative?.name==="carte.png"
};
console.log(JSON.stringify({...results,...checks},null,2));
const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
if(failed.length){console.error("Vérifications en échec : "+failed.join(", "));process.exitCode=1;}
else console.log("Reprise d’un appareil à l’autre : les 7 vérifications passent.");
