// Démonstration locale : site, questionnaires, aperçu des mails dans /test-audit et espace admin peuplé de dossiers fictifs.
import path from "node:path";
import {readFile,writeFile,rm} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {createApp} from "../server.js";
import {createStorage} from "../storage.js";
import {auditText,cleanAnswers} from "../logic.js";

const port=Number(process.env.PORT||3001),dataDir=path.resolve(".data-demo");
// AEM_ORIGIN permet d’exposer la démo derrière un tunnel (l’envoi du questionnaire vérifie l’origine) ; TRUST_PROXY=1 derrière ce tunnel.
const origin=process.env.AEM_ORIGIN||"http://127.0.0.1:"+port;
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=","base64");
const pdf=Buffer.from("%PDF-1.4\n% DOCUMENT FICTIF DE DEMONSTRATION AEM\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
const day=86400000;
// Six dossiers manifestement fictifs (noms « Exemple », adresses example.test) : un par situation du secrétariat.
const base={workflow:"ants",nationality:"francaise",identityDocument:"cni_fr",identityExpiry:"2031-04-01",home:"own",homeProof:"facture",homeDate:"2026-08",special:"non"};
const dossiers=[
 {answers:{...base,birthName:"EXEMPLE",firstName:"Léa",birthDate:"2008-05-14",phone:"0611111111",email:"lea@example.test",home:"parents",hostingDate:"2026-08-02",parentExpiry:"2030-01-01",contactName:"Parent Exemple",contactPhone:"0622222222",contactEmail:"parent@example.test"},files:{identity_cni_fr:["cni-lea.png",png],home_parents:["facture-parents.pdf",pdf],hosting:["attestation.pdf",pdf],parent_identity:["cni-parent.png",png],assr_2:["assr2.png",png]},deferred:["jdc"],status:"received"},
 {answers:{...base,birthName:"EXEMPLE",firstName:"Karim",birthDate:"2004-11-02",phone:"0633333333",email:"karim@example.test"},files:{identity_cni_fr:["cni-karim.png",png],home_own:["facture.pdf",pdf],jdc:["jdc.png",png]},status:"in_progress",assignedTo:"marie"},
 {answers:{...base,birthName:"EXEMPLE",firstName:"Inès",birthDate:"2006-02-20",phone:"0644444444",email:"ines@example.test"},files:{identity_cni_fr:["cni-ines.png",png],home_own:["quittance.pdf",pdf]},status:"missing_pieces",request:{daysAgo:12,pieces:"JDC ou avis de situation"}},
 {answers:{...base,workflow:"permis",permitType:"first",birthName:"EXEMPLE",firstName:"Tom",birthDate:"2005-09-09",phone:"0655555555",email:"tom@example.test",medical:"non"},files:{identity_cni_fr:["cni-tom.png",png],home_own:["facture.pdf",pdf],permit_cepc:["cepc.pdf",pdf]},status:"ready",assignedTo:"luc"},
 {answers:{...base,workflow:"permis",permitType:"renewal",birthName:"EXEMPLE",firstName:"Sofia",birthDate:"1990-03-30",phone:"0666666666",email:"sofia@example.test",medical:"oui"},files:{identity_cni_fr:["cni-sofia.png",png],home_own:["impots.pdf",pdf],permit_current:["permis.png",png]},deferred:["medical"],status:"received"},
 {answers:{...base,birthName:"EXEMPLE",firstName:"Nathan",birthDate:"2003-07-07",phone:"0677777777",email:"nathan@example.test"},files:{identity_cni_fr:["cni-nathan.png",png],home_own:["facture.pdf",pdf]},status:"archived"}
];
async function seed(){
 const storage=createStorage(dataDir);
 if((await storage.list()).length)return storage;
 for(const d of dossiers){
  const answers=cleanAnswers({...d.answers,deferred:d.deferred||[]});
  const uploads=Object.entries(d.files).map(([key,[name,content]])=>({key,name,size:content.length,contentType:name.endsWith(".pdf")?"application/pdf":"image/png",content}));
  const submission={submissionId:randomUUID(),answers,uploads};
  await storage.save(submission,auditText(answers,uploads),{incomplete:Boolean(d.deferred?.length),deferredCount:d.deferred?.length||0});
  if(d.assignedTo)await storage.update(submission.submissionId,{assignedTo:d.assignedTo},{by:"démo"});
  if(d.request)await storage.update(submission.submissionId,{status:"missing_pieces"},{by:"marie",action:"request",details:"Pièces demandées à "+answers.email+" : "+d.request.pieces});
  if(d.status && d.status!=="missing_pieces")await storage.update(submission.submissionId,{status:d.status},{by:"marie"});
  if(d.request){
   // Relance antidatée pour montrer la file « relancés sans réponse ».
   const file=path.join(dataDir,submission.submissionId,"meta.json");
   const meta=JSON.parse(await readFile(file,"utf8"));
   for(const e of meta.history)if(e.action==="request")e.at=new Date(Date.now()-d.request.daysAgo*day).toISOString();
   await writeFile(file,JSON.stringify(meta,null,2));
  }
 }
 await storage.rebuildIndex();
 return storage;
}
if(process.argv.includes("--reset"))await rm(dataDir,{recursive:true,force:true});
await seed();
const app=createApp({demo:true,config:{host:"127.0.0.1",port,origin,basePath:"",trustProxy:process.env.TRUST_PROXY==="1",dataDir,receiptDir:path.join(dataDir,".receipts"),adminAccounts:"demo:demo:responsable;marie:demo:traitement;accueil:demo:lecture",adminPassword:"",adminPrefill:"demo:demo",candidateMail:false,retentionDays:30}});
app.on("error",error=>{console.error(error.code==="EADDRINUSE"?"Le port 3001 est déjà utilisé. Ouvrez http://127.0.0.1:3001/ ou arrêtez l’autre serveur.":error.message);process.exitCode=1;});
app.listen(port,"127.0.0.1",()=>console.log("Démonstration sans e-mail : site http://127.0.0.1:"+port+"/ · aperçu des envois /test-audit · admin http://127.0.0.1:"+port+"/admin.html (demo / demo, responsable ; marie / demo, traitement ; accueil / demo, lecture). Données fictives dans .data-demo (--reset pour repartir de zéro)."));
