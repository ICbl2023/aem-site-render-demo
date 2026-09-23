// Test explicite via le même endpoint que le candidat : deux dossiers fictifs.
// HTTP 200 confirme l’acceptation du dossier (stockage + reçu), pas l’envoi du mail admin.
import {randomUUID} from "node:crypto";
const target=process.argv[2];
if(!target){console.error("Usage : npm run test:mail -- https://votre-serveur.example/");process.exit(1);}
const base=new URL(target.endsWith("/")?target:target+"/");
if(base.protocol!=="https:" && !(base.protocol==="http:" && ["localhost","127.0.0.1"].includes(base.hostname)))throw new Error("Utilisez une URL HTTPS (ou localhost pour un test local).");
if(base.username||base.password||base.search||base.hash)throw new Error("Utilisez l’URL publique simple du serveur, sans identifiants ni paramètres.");
const configResponse=await fetch(new URL("api/config",base));
if(!configResponse.ok || !(await configResponse.json()).enabled)throw new Error("Le serveur n’annonce pas un envoi configuré. Aucun dossier de test envoyé.");
const stream="BT /F1 16 Tf 50 740 Td (DOCUMENT FICTIF - TEST DE TRANSMISSION AEM) Tj ET";
const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];
let pdf="%PDF-1.4\n";const offsets=[0];
objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+obj+"\nendobj\n";});
const xref=Buffer.byteLength(pdf);
pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
const attachment=Buffer.from(pdf);
for(const workflow of ["ants","permis"]){
 const id=randomUUID(),data=new FormData(),files=[];
 const homeDate=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit"}).format(new Date());
 const answers={workflow,birthName:"TEST-AEM",firstName:"Transmission",birthDate:"2000-01-01",phone:"0600000000",email:"test@example.test",nationality:"francaise",identityDocument:"cni_fr",identityExpiry:"",home:"own",homeProof:"facture",homeDate,special:"non",medical:"non",...(workflow==="permis"?{permitType:"renewal"}:{})};
 const keys=["identity_cni_fr","home_own",...(workflow==="permis"?["permit_current"]:[])];
 keys.forEach((key,index)=>{
 const field="file_"+index,name="TEST-FICTIF-"+key+".pdf";
 data.append(field,new Blob([attachment],{type:"application/pdf"}),name);
 files.push({field,key,name,size:attachment.length});
 });
 data.append("payload",JSON.stringify({submissionId:id,answers,files}));data.append("website","");
 const response=await fetch(new URL("api/submit",base),{method:"POST",headers:{Origin:base.origin,"X-AEM-Request":"questionnaire"},body:data});
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result?.ok||result.submissionId!==id)throw new Error("Test "+workflow+" : dossier non accepté (HTTP "+response.status+", référence "+id+"). Vérifiez côté administration avant de relancer.");
 console.log(workflow.toUpperCase()+" : dossier accepté (HTTP 200). Cela ne prouve pas l’envoi ni la réception du mail admin. Référence : "+id);
}
console.log("Vérifiez dans l’Admin l’état adminNotify (sent/failed/uncertain/skipped) et, si besoin, la boîte destinataire. L’acceptation fournisseur ne prouve pas la réception dans Gmail.");
