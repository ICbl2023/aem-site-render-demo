import http from "node:http";
import {questionnairePublicFiles} from "./questionnaire-files.js";
import {createDemo} from "./demo.js";
import {readFile,mkdir,writeFile,rename,readdir,stat,unlink} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import Busboy from "busboy";
import nodemailer from "nodemailer";
import {config as defaultConfig} from "./server-config.js";
import {cleanAnswers,answerErrors,documentsFor,auditText,subjectFor,acceptedExtensions,missingRequiredDocuments,deferredDocuments,isDeferred,workflows} from "./logic.js";
import {createStorage,dossierStatuses,historyActions,isSubmissionId,STALE_AFTER_DAYS} from "./storage.js";
import {createDraftStorage,parseDraftToken,DRAFT_ANSWER_BYTES} from "./draft-storage.js";
import {createBlobStoreFromConfig} from "./blob-store.js";
import {DRAFT_DAYS} from "./drafts.js";
import {createAdminAuth} from "./admin-auth.js";
import {createChat} from "./chat-server.js";
const root=path.dirname(fileURLToPath(import.meta.url));
const staticFiles=new Map([
 ["","portail.html"],["ants.html","ants.html"],["permis.html","permis.html"],["portail.html","portail.html"],
 ["formations.html","formations.html"],["tarifs.html","tarifs.html"],["demarches.html","demarches.html"],["inscription.html","inscription.html"],["apres-examen.html","apres-examen.html"],["rendez-vous.html","rendez-vous.html"],["contact.html","contact.html"],["mentions-legales.html","mentions-legales.html"],["confidentialite.html","confidentialite.html"],["chat.js","chat.js"],["assist.js","assist.js"],["assist-extract.js","assist-extract.js"],["guide.js","guide.js"],
 ["drafts.js","drafts.js"],["draft-ui.js","draft-ui.js"],["draft-remote.js","draft-remote.js"],["draft-boot.js","draft-boot.js"],["styles.css","styles.css"],["app.js","app.js"],["logic.js","logic.js"],["voice.js","voice.js"],["icons.js","icons.js"],["scene.js","scene.js"],["fonts/overpass-var.woff2","fonts/overpass-var.woff2"],["fonts/atkinson-var.woff2","fonts/atkinson-var.woff2"],["admin.html","admin.html"],["admin.css","admin.css"],["admin.js","admin.js"],
 ["cropped-logo_auto-ecole-meyzieu.png","cropped-logo_auto-ecole-meyzieu.png"]
]);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".woff2":"font/woff2",".mp3":"audio/mpeg",".ogg":"audio/ogg",".m4a":"audio/mp4",".json":"application/json; charset=utf-8"};
const fail=(status,message)=>Object.assign(new Error(message),{status});
function json(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));}
// TRUST_PROXY suppose un seul proxy de confiance : seule la DERNIÈRE valeur de X-Forwarded-For (celle qu'il ajoute) est retenue,
// les valeurs précédentes pouvant être fournies par le client.
function clientIp(req,trustProxy){
 if(trustProxy){
  const forwarded=String(req.headers["x-forwarded-for"]||"").split(",").at(-1).trim();
  if(forwarded)return forwarded;
 }
 return req.socket.remoteAddress||"unknown";
}
// Date de réception du dossier : les documents attendus sont figés à cette date (l'âge peut changer ensuite).
function receivedAt(meta){const d=new Date(meta.createdAt||NaN);return Number.isNaN(d.getTime())?new Date():d;}
// Jour civil à l'heure de Paris (« reçus aujourd'hui ») ; "" pour une date absente ou invalide (format() lèverait une RangeError).
const parisDay=new Intl.DateTimeFormat("fr-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"});
function dayOf(value){const d=new Date(value||NaN);return Number.isNaN(d.getTime())?"":parisDay.format(d);}
const withWorkflowLabel=meta=>({...meta,workflowLabel:workflows[meta.workflow]||meta.workflow});
function adminPatch(body){
 const patch={};
 if(typeof body!=="object" || !body || Array.isArray(body))throw fail(400,"Corps de requête invalide.");
 if(body.assignedTo!==undefined){
  if(typeof body.assignedTo!=="string" || body.assignedTo.length>64 || /[\u0000-\u001f\u007f]/.test(body.assignedTo))throw fail(400,"Nom de suivi invalide (64 caractères maximum).");
  patch.assignedTo=body.assignedTo;
 }
 if(body.status!==undefined){
  if(!Object.hasOwn(dossierStatuses,body.status))throw fail(400,"Statut invalide.");
  patch.status=body.status;
 }
 if(body.adminNote!==undefined){
  // Note multiligne saisie en textarea : tabulation et sauts de ligne conservés, autres caractères de contrôle refusés ; pas de troncature silencieuse.
  if(typeof body.adminNote!=="string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.adminNote))throw fail(400,"Note invalide.");
  if(body.adminNote.length>4000)throw fail(400,"Note trop longue (4000 caractères maximum).");
  patch.adminNote=body.adminNote;
 }
 if(!Object.keys(patch).length)throw fail(400,"Aucune modification demandée.");
 return patch;
}
export const aemContact="Auto-école Majolane\n46 rue de la République, 69330 Meyzieu\nTéléphone : 04 78 31 79 85\nE-mail : aem69330@gmail.com";
const shortRef=id=>String(id).slice(0,8);
const workflowLabel=answers=>workflows[answers.workflow]||"AEM";
function requestBody(body,documents){
 if(typeof body!=="object" || !body || Array.isArray(body))throw fail(400,"Corps de requête invalide.");
 if(!Array.isArray(body.pieces) || !body.pieces.length)throw fail(400,"Sélectionnez au moins une pièce à demander.");
 const pieces=[];
 for(const key of body.pieces){
 const doc=documents.find(d=>d.key===key);
 if(!doc)throw fail(400,"Pièce inconnue pour ce dossier.");
 if(!pieces.some(d=>d.key===key))pieces.push(doc);
 }
 const message=body.message===undefined?"":body.message;
 if(typeof message!=="string" || message.length>2000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(message))throw fail(400,"Message invalide (2000 caractères maximum).");
 return {pieces,message:message.trim()};
}
// Accusé candidat : seuls les libellés des pièces sont repris (jamais les noms de fichiers), le destinataire est nommé par son prénom seul.
export function prepareCandidateMail(submission,config){
 const {answers,uploads,submissionId}=submission,documents=documentsFor(answers);
 const deferred=deferredDocuments(answers,uploads),deferredKeys=new Set(deferred.map(d=>d.key));
 const received=documents.filter(d=>uploads.some(f=>f.key===d.key)).map(d=>"- "+d.label);
 const missing=missingRequiredDocuments(answers,uploads).filter(d=>!deferredKeys.has(d.key));
 const lines=["Bonjour "+answers.firstName+",","","Nous avons bien reçu votre dossier "+workflowLabel(answers)+" transmis à l’Auto-école Majolane.","","Pièces reçues :",...(received.length?received:["- Aucun fichier transmis"])];
 if(deferred.length)lines.push("","Pièces à fournir, AEM vous recontactera :",...deferred.map(d=>"- "+d.label));
 if(missing.length)lines.push("","Pièces manquantes :",...missing.map(d=>"- "+d.label));
 lines.push("",deferred.length
 ?"Prochaines étapes : préparez les pièces listées ci-dessus ; AEM vous recontactera pour convenir de leur transmission (réponse à cet e-mail ou dépôt à l’auto-école) et vérifie le reste du dossier."
 :"Prochaines étapes : AEM vérifie votre dossier et vous recontacte si un complément est nécessaire. Aucune action n’est attendue de votre part pour le moment.");
 lines.push("","Référence complète : "+submissionId,"","Cordialement,",aemContact);
 return {
 from:config.from,to:{address:answers.email,name:answers.firstName},replyTo:config.recipient||undefined,
 subject:"AEM — votre dossier "+workflowLabel(answers)+" est bien reçu (réf. "+shortRef(submissionId)+")",
 text:lines.join("\n"),disableFileAccess:true,disableUrlAccess:true
 };
}
// Lien de reprise : le seul moyen de retrouver un brouillon depuis un autre appareil. Le message est écrit pour
// être transférable tel quel (un mineur l'envoie à son responsable), d'où l'avertissement sur le partage.
export function prepareResumeMail({email,firstName,workflow,resumeUrl,expiresAt},config){
 const who=String(firstName||"").trim();
 const lines=[
  who?"Bonjour "+who+",":"Bonjour,","",
  "Voici le lien pour reprendre votre dossier "+(workflows[workflow]||"AEM")+" à l’Auto-école Majolane :","",
  resumeUrl,"",
  "Ce lien rouvre le questionnaire là où vous l’avez laissé, depuis n’importe quel téléphone, tablette ou ordinateur. Vos réponses et documents sont conservés jusqu’au "+frDateTime(new Date(expiresAt).toISOString())+" ("+DRAFT_DAYS+" jours après la dernière modification).","",
  "Si vous préférez qu’un proche termine le dossier avec vous (un parent pour un mineur, par exemple), transmettez-lui ce lien.",
  "Ne le publiez pas : toute personne qui l’ouvre voit les réponses et les documents déjà déposés.","",
  "Tant que le dossier n’est pas envoyé, rien n’est transmis à l’administration.","",
  "Cordialement,",aemContact
 ];
 return {
  from:config.from,to:{address:email,...(who?{name:who}:{})},replyTo:config.recipient||undefined,
  subject:"AEM — reprenez votre dossier "+(workflows[workflow]||"")+" quand vous voulez",
  text:lines.join("\n"),disableFileAccess:true,disableUrlAccess:true
 };
}
export function prepareReadyMail(meta,config){
 const lines=["Bonjour "+meta.firstName+",","","Bonne nouvelle : votre dossier "+workflowLabel(meta.answers||{workflow:meta.workflow})+" (réf. "+shortRef(meta.id)+") est complet. L’Auto-école Majolane le dépose auprès de l’administration.","","Aucune action n’est attendue de votre part. Nous vous recontacterons si l’administration demande un complément.","","Référence complète : "+meta.id,"","Cordialement,",aemContact];
 return {from:config.from,to:{address:meta.email,name:meta.firstName},replyTo:config.recipient||undefined,subject:"AEM — votre dossier est complet et déposé (réf. "+shortRef(meta.id)+")",text:lines.join("\n"),disableFileAccess:true,disableUrlAccess:true};
}
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const frDateTime=value=>value?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"—";
// Fiche imprimable : HTML autonome, sans script, pour l'impression ou l'archivage papier.
export function renderExport(meta,documents,{expiresAt=null,by=""}={}){
 const a=meta.answers||{};
 const rows=[["Référence",meta.id],["Parcours",meta.workflowLabel],["Statut",dossierStatuses[meta.status]||meta.status],["Suivi par",meta.assignedTo||"—"],["Reçu le",frDateTime(meta.createdAt)],["Naissance",a.birthDate||meta.birthDate||"—"],["Téléphone",meta.phone||"—"],["E-mail",meta.email||"—"]];
 if(a.contactName)rows.push(["Responsable (mineur)",a.contactName+" · "+(a.contactPhone||"")+(a.contactEmail?" · "+a.contactEmail:"")]);
 if(expiresAt)rows.push(["Effacement prévu",frDateTime(expiresAt)]);
 const pieces=documents.map(d=>"<li>"+esc(d.label)+" — "+(d.fileCount?"reçue ("+d.fileCount+" fichier(s))":d.deferred?"à récupérer (le candidat ne l’avait pas)":"manquante")+"</li>").join("");
 const history=[...(meta.history||[])].reverse().map(e=>"<li>"+esc(frDateTime(e.at))+" · "+esc(e.by||"système")+" · "+esc(historyActions[e.action]||e.action)+(e.details?" — "+esc(e.details):"")+"</li>").join("");
 return '<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Dossier '+esc((meta.birthName||"").toUpperCase()+" "+(meta.firstName||""))+' — AEM</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#0B1A33;margin:32px;max-width:820px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #D5DCE8;padding-bottom:4px}table{border-collapse:collapse;width:100%}td{padding:6px 8px;border-bottom:1px solid #E5EBF3;vertical-align:top}td:first-child{color:#4A5B75;width:32%}pre{white-space:pre-wrap;background:#F4F6FA;padding:12px;border-radius:8px;font:13px/1.5 ui-monospace,monospace}ul{padding-left:20px}.meta{color:#4A5B75;font-size:12px}@media print{body{margin:12mm}}</style></head><body><h1>'+esc((meta.birthName||"").toUpperCase()+" "+(meta.firstName||""))+'</h1><p class="meta">Auto-école Majolane · fiche imprimée le '+esc(frDateTime(new Date().toISOString()))+(by?" par "+esc(by):"")+' · document interne, ne pas diffuser</p><h2>Dossier</h2><table>'+rows.map(([k,v])=>"<tr><td>"+esc(k)+"</td><td>"+esc(v)+"</td></tr>").join("")+'</table><h2>Pièces</h2><ul>'+(pieces||"<li>Aucune pièce attendue.</li>")+'</ul><h2>Note interne</h2><p>'+(esc(meta.adminNote||"")||"—")+'</p><h2>Audit</h2><pre>'+esc(meta.auditText||"")+'</pre><h2>Historique</h2><ul>'+(history||"<li>Aucune entrée.</li>")+'</ul></body></html>';
}
export function prepareRequestMail(meta,pieces,message,config){
 const lines=["Bonjour "+meta.firstName+",","","Pour compléter votre dossier "+workflowLabel(meta.answers||{workflow:meta.workflow})+" (réf. "+shortRef(meta.id)+"), l’Auto-école Majolane a besoin des pièces suivantes :",...pieces.map(d=>"- "+d.label)];
 if(message)lines.push("","Message d’AEM :",message);
 lines.push("","Vous pouvez répondre à cet e-mail en joignant les documents, ou les déposer à l’auto-école.","","Référence complète : "+meta.id,"","Cordialement,",aemContact);
 return {
 from:config.from,to:{address:meta.email,name:meta.firstName},replyTo:config.recipient||undefined,
 subject:"AEM — pièces à fournir pour votre dossier (réf. "+shortRef(meta.id)+")",
 text:lines.join("\n"),disableFileAccess:true,disableUrlAccess:true
 };
}
export function detectedType(buffer,filename){
 const ext=filename.split(".").pop().toLowerCase();
 if(!acceptedExtensions.includes(ext))return null;
 if(ext==="pdf" && buffer.subarray(0,5).toString()==="%PDF-")return "application/pdf";
 if(["jpg","jpeg"].includes(ext) && buffer[0]===255 && buffer[1]===216 && buffer[2]===255)return "image/jpeg";
 if(ext==="png" && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return "image/png";
 if(ext==="webp" && buffer.subarray(0,4).toString()==="RIFF" && buffer.subarray(8,12).toString()==="WEBP")return "image/webp";
 if(["heic","heif"].includes(ext) && buffer.subarray(4,8).toString()==="ftyp"){
 const boxSize=buffer.readUInt32BE(0);
 if(boxSize<16 || boxSize>buffer.length || boxSize>4096)return null;
 const brands=buffer.subarray(8,boxSize).toString("ascii");
 if(/heic|heix|hevc|hevx|mif1|msf1/.test(brands))return "image/"+ext;
 }
 return null;
}
function parseMultipart(req,limits,allowedFields=["payload","website"]){
 return new Promise((resolve,reject)=>{
 let parser;try{parser=Busboy({headers:req.headers,defParamCharset:"utf8",limits:{files:limits.fileCount,fileSize:limits.fileBytes+1,fields:2,fieldSize:65536,parts:limits.fileCount+3}});}catch{reject(fail(400,"Requête d’envoi invalide."));return;}
 const fields={},uploads=[];let error=null,bytes=0,settled=false;
 const finishError=e=>{if(settled)return;settled=true;reject(e);};
 req.on("data",chunk=>{bytes+=chunk.length;if(bytes>limits.totalBytes+128*1024){error=fail(413,"L’ensemble des fichiers dépasse la limite d’envoi.");req.unpipe(parser);parser.destroy();req.resume();finishError(error);}});
 req.on("error",()=>finishError(fail(400,"Envoi interrompu.")));
 req.on("aborted",()=>finishError(fail(400,"Envoi interrompu.")));
 parser.on("field",(name,value,info)=>{if(!allowedFields.includes(name) || Object.hasOwn(fields,name) || info.valueTruncated)error=fail(400,"Champs d’envoi invalides.");fields[name]=value;});
 parser.on("file",(field,stream,info)=>{
 const chunks=[];let size=0;
 stream.on("data",chunk=>{size+=chunk.length;if(!error)chunks.push(chunk);});
 stream.on("limit",()=>{error=fail(413,"Un fichier dépasse la limite autorisée.");});
 stream.on("error",finishError);
 stream.on("end",()=>{if(size>limits.fileBytes)error=fail(413,"Un fichier dépasse la limite autorisée.");uploads.push({field,name:info.filename,size,content:Buffer.concat(chunks)});});
 });
 for(const event of ["filesLimit","fieldsLimit","partsLimit"])parser.on(event,()=>{error=fail(413,"Trop de fichiers ou de champs.");});
 parser.on("error",()=>finishError(fail(400,"Envoi multipart incomplet ou invalide.")));
 parser.on("close",()=>{if(settled)return;settled=true;error?reject(error):resolve({fields,uploads});});
 req.pipe(parser);
 });
}
function validatedSubmission(fields,uploads,limits){
 if(fields.website)throw fail(400,"Envoi refusé.");
 let payload;try{payload=JSON.parse(fields.payload);}catch{throw fail(400,"Réponses illisibles.");}
 if(!payload || typeof payload.answers!=="object" || !payload.answers || Array.isArray(payload.answers) || !Array.isArray(payload.files) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(payload.submissionId||""))throw fail(400,"Données d’envoi invalides.");
 const answers=cleanAnswers(payload.answers),errors=answerErrors(answers);
 if(errors.length)throw fail(422,errors[0].message);
 const allowed=new Set(documentsFor(answers).map(d=>d.key)),used=new Set();
 if(payload.files.length!==uploads.length)throw fail(400,"La liste des fichiers ne correspond pas aux pièces reçues.");
 let total=0;
 for(const upload of uploads){
 const item=payload.files.find(f=>f?.field===upload.field);
 if(!item || used.has(upload.field) || !allowed.has(item.key) || item.name!==upload.name || item.size!==upload.size)throw fail(400,"Un fichier ne correspond pas à la situation déclarée.");
 if(!upload.name || upload.name.length>200 || /[\\/\r\n\u0000-\u001f\u007f]/.test(upload.name))throw fail(400,"Nom de fichier non accepté.");
 used.add(upload.field);total+=upload.size;
 const contentType=detectedType(upload.content,upload.name);
 if(!upload.size || !contentType)throw fail(415,"Format ou contenu non accepté : "+upload.name);
 Object.assign(upload,{key:item.key,contentType});
 }
 const missing=missingRequiredDocuments(answers,uploads);
 if(missing.length)throw fail(422,"Documents nécessaires non transmis : "+missing.map(d=>d.label).join(", "));
 if(total>limits.totalBytes)throw fail(413,"L’ensemble des fichiers dépasse la limite d’envoi.");
 return {answers,uploads,submissionId:payload.submissionId};
}
export function prepareMail(submission,config,{adminUrl=null,attachments=false}={}){
 const audit=auditText(submission.answers,submission.uploads);
 const link=adminUrl||config.adminUrl||"";
 const adminLine=link?"\n\nOuvrir la zone admin : "+link:"\n\nOuvrez la zone admin sur votre serveur pour consulter l’audit complet et les pièces.";
 const deferred=deferredDocuments(submission.answers,submission.uploads);
 const deferredLine=deferred.length?"\nPièces à récupérer : "+deferred.map(d=>d.label).join(", "):"";
 const name=(submission.answers.birthName||"").toUpperCase()+" "+(submission.answers.firstName||"");
 const text=attachments
 ? audit+"\n\nRéférence de transmission : "+submission.submissionId+adminLine
 : "Nouveau dossier arrivé dans la zone admin AEM\n\nCandidat : "+name+"\nDémarche : "+(workflows[submission.answers.workflow]||submission.answers.workflow)+"\nRéférence : "+submission.submissionId+"\nE-mail : "+submission.answers.email+"\nTéléphone : "+submission.answers.phone+deferredLine+"\n\nLe dossier est disponible dans la zone admin (audit complet et pièces jointes)."+adminLine+"\n\n— Extrait —\n"+audit.split("\n").slice(0,12).join("\n");
 return {
 from:config.from,to:config.recipient,replyTo:{address:submission.answers.email,name:submission.answers.firstName+" "+submission.answers.birthName},
 subject:"[AEM Admin] Nouveau dossier — "+subjectFor(submission.answers),
 text,
 ...(attachments?{attachments:submission.uploads.map(f=>({filename:f.name,content:f.content,contentType:f.contentType,contentDisposition:"attachment"}))}:{}),
 disableFileAccess:true,disableUrlAccess:true
 };
}
export function createMailTransport(config){
 return nodemailer.createTransport({
 host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,requireTLS:config.smtpPort!==465,
 ...(config.smtpUser?{auth:{user:config.smtpUser,pass:config.smtpPass}}:{}),
 connectionTimeout:15000,greetingTimeout:15000,socketTimeout:45000,
 disableFileAccess:true,disableUrlAccess:true
 });
}
async function readBody(req,max=8192){
 const chunks=[];let size=0;
 for await(const chunk of req){
 size+=chunk.length;
 if(size>max)throw fail(413,"Corps de requête trop volumineux.");
 chunks.push(chunk);
 }
 return Buffer.concat(chunks).toString("utf8");
}
// Corps JSON : un texte non analysable répond 400 avec un message contrôlé (jamais le message brut de JSON.parse) ; le 413 de readBody se propage inchangé.
async function readJson(req,max){
 const text=await readBody(req,max);
 try{return JSON.parse(text);}catch{throw fail(400,"Corps de requête illisible.");}
}
export function createApp(options={}){
 const config={...defaultConfig,...options.config};
 const publicFiles=config.standalone?new Map([...questionnairePublicFiles.map(name=>[name,name]),["","portail.html"],["portail.html","portail.html"]]):staticFiles;
 const demo=options.demo===true?createDemo(config.basePath):null;
 // Blobs : null/omit = fichiers legacy à côté des meta ; memory/r2/local via options.blobs (tests ou prod R2).
 const blobs=options.blobs||null;
 const storage=options.storage || createStorage(path.resolve(root,config.dataDir),blobs?{blobs}:{});
 const draftsEnabled=Boolean(config.drafts && config.draftDir);
 const draftStorage=draftsEnabled?(options.draftStorage || createDraftStorage(path.resolve(root,config.draftDir),blobs?{blobs}:{})):null;
 const auth=createAdminAuth(config);
 const chat=createChat({config,dataDir:path.resolve(root,config.dataDir)});
 const mailEnabled=Boolean(config.smtpHost && config.from && config.recipient);
 const storageEnabled=Boolean(config.dataDir);
 const enabled=Boolean(demo || options.transport || (config.origin && (mailEnabled || storageEnabled)));
 const transport=demo?null:options.transport || (mailEnabled?createMailTransport(config):null);
 const rates=new Map(),inflight=new Set(),ackRates=new Map();let active=0;
 const ACK_MAX=3,ACK_WINDOW_MS=24*60*60*1000;
 // Brouillons : deux plafonds distincts par IP. Les sauvegardes sont fréquentes et légitimes (une par pause de saisie),
 // alors que créer un brouillon réserve de l'espace disque et doit rester rare. Les liens envoyés par mail le sont encore plus.
 const draftRates=new Map(),draftLinkRates=new Map();
 const DRAFT_WINDOW_MS=15*60*1000,DRAFT_MAX=600,DRAFT_CREATE_MAX=30,DRAFT_LINK_MAX=5,DRAFT_LINK_WINDOW_MS=24*60*60*1000;
 function overLimit(map,key,max,windowMs){
  const now=Date.now();
  for(const [k,r] of map)if(r.until<now)map.delete(k);
  const rate=map.get(key)||{count:0,until:now+windowMs};
  rate.count++;map.set(key,rate);
  return rate.count>max;
 }
 const receiptRoot=path.resolve(root,config.receiptDir);
 const adminBase=config.adminUrl || ((config.origin||"")+config.basePath+"/admin.html");
 async function receipt(id){try{return JSON.parse(await readFile(path.join(receiptRoot,id+".json"),"utf8"));}catch(e){if(e.code==="ENOENT")return null;throw e;}}
 async function record(id,value){
 await mkdir(receiptRoot,{recursive:true,mode:0o700});
 const target=path.join(receiptRoot,id+".json"),tmp=target+".tmp";
 await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,target);
 }
 function securityHeaders(res){
 res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","no-referrer");
 res.setHeader("X-Frame-Options","DENY");
 res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=(), payment=()");
 res.setHeader("Cross-Origin-Resource-Policy","same-origin");
 if(config.origin?.startsWith("https://"))res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
 res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
 }
 function requireAdmin(req,res){
 const token=auth.parseCookie(req.headers.cookie,"aem_admin");
 const info=auth.sessionInfo(token);
 if(!info){json(res,401,{error:"Session expirée."});return null;}
 return {token,user:info.user,role:info.role};
 }
 // Rôle lecture : consultation seule. Toute écriture répond 403 avec un message clair.
 function readOnly(session,res){
 if(session.role!=="lecture")return false;
 json(res,403,{error:"Compte en lecture seule : cette action est réservée aux comptes de traitement."});return true;
 }
 const expiresAtOf=meta=>config.retentionDays>0 && meta.createdAt?new Date(new Date(meta.createdAt).getTime()+config.retentionDays*86400000).toISOString():null;
 // Anti-CSRF : en-tête X-AEM-Admin (envoyé par admin.js) ; un corps JSON déclenche de toute façon une pré-vérification CORS refusée ici.
 function adminRequestAllowed(req){
 return req.headers["x-aem-admin"]==="1" || String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json");
 }
 async function consumeDraft(req){
  if(!draftStorage)return;
  const token=req.headers["x-aem-draft"];
  if(!token)return;
  // L'envoi a réussi : le lien de reprise ne doit plus ouvrir les pièces, même si l'effacement local échoue.
  await draftStorage.remove(token).catch(()=>{});
 }
 async function sendTo(mail,address){
 const result=await transport.sendMail(mail);
 if(!result.accepted?.some(a=>String(a).toLowerCase()===address.toLowerCase()))throw fail(502,"Le serveur de messagerie n’a pas accepté le destinataire.");
 return result;
 }
 // Accusé de réception candidat : son échec n’annule jamais la soumission, l’état est tracé dans le dossier.
 // Plafond en mémoire de 3 accusés par adresse (normalisée) et par 24 h : le formulaire ne doit pas servir de relais de courrier.
 async function acknowledgeCandidate(submission){
 const email=submission.answers.email;
 if(!transport || !config.candidateMail || !email)return "skipped";
 const key=email.trim().toLowerCase(),now=Date.now();
 for(const [k,r] of ackRates)if(r.until<now)ackRates.delete(k);
 const rate=ackRates.get(key)||{count:0,until:now+ACK_WINDOW_MS};
 let state="sent",details="Accusé de réception envoyé à "+email;
 if(rate.count>=ACK_MAX){state="skipped";details="Accusé de réception non envoyé à "+email+" : plafond atteint ("+ACK_MAX+" accusés par 24 h pour cette adresse)";}
 else{
 rate.count++;ackRates.set(key,rate);
 try{await sendTo(prepareCandidateMail(submission,config),email);}catch(e){state="failed";details="Échec de l’accusé de réception à "+email+" : "+(e.message||"erreur");}
 }
 await storage.update(submission.submissionId,{candidateMail:state},{action:"candidate_mail",details}).catch(()=>{});
 return state;
 }
 async function handle(req,res){
 securityHeaders(res);
 let url;try{url=new URL(req.url,"http://localhost");}catch{return json(res,400,{error:"URL invalide."});}
 const prefix=config.basePath+"/";if(!url.pathname.startsWith(prefix))return json(res,404,{error:"Page introuvable."});
 const route=url.pathname.slice(prefix.length);
 if(req.method==="GET" && route==="api/config")return json(res,200,{enabled,limits:config.limits,drafts:draftsEnabled,draftDays:DRAFT_DAYS,draftMail:Boolean(transport),...(demo?{demo:true}:{})});
 if(req.method==="GET" && route==="api/admin/session"){const info=auth.sessionInfo(auth.parseCookie(req.headers.cookie,"aem_admin"));const prefill=config.adminPrefill?{user:config.adminPrefill.split(":")[0]||"",password:config.adminPrefill.split(":").slice(1).join(":")}:null;return json(res,200,{authenticated:Boolean(info),user:info?.user??null,role:info?.role??null,roles:auth.roles,statuses:dossierStatuses,historyActions,...(prefill?{prefill}:{})});}
 if((!config.standalone && route==="api/chat") || route==="api/assist"){
 const tools={json,readBody:r=>readBody(r,32*1024),clientIp:r=>clientIp(r,config.trustProxy)};
 return route==="api/chat"?chat.handle(req,res,tools):chat.handleAssist(req,res,tools);
 }
 // Brouillons partagés. Protection CSRF : l'en-tête X-AEM-Request impose une pré-vérification CORS à tout autre site ;
 // l'origine n'est contrôlée que lorsque le navigateur l'envoie (absente sur un GET same-origin).
 const draftFile=route.match(/^api\/draft\/files\/(\d{1,4})$/);
 if(route==="api/draft" || route==="api/draft/link" || route==="api/draft/files" || draftFile){
  if(!draftsEnabled)return json(res,503,{error:"La reprise d’un appareil à l’autre n’est pas activée sur cet hébergement."});
  if(req.headers["x-aem-request"]!=="questionnaire")return json(res,403,{error:"Requête refusée."});
  if(req.headers.origin && config.origin && req.headers.origin!==config.origin)return json(res,403,{error:"Origine de la demande non autorisée."});
  const ip=clientIp(req,config.trustProxy);
  if(overLimit(draftRates,ip,DRAFT_MAX,DRAFT_WINDOW_MS))return json(res,429,{error:"Trop de requêtes. Patientez quelques minutes : vos réponses restent enregistrées sur cet appareil."});
  const token=req.headers["x-aem-draft"];
  try{
   // Pièces du brouillon : mêmes limites et même contrôle du contenu réel qu'à l'envoi définitif.
   if(route==="api/draft/files"){
    if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
    if(req.headers.origin!==config.origin)return json(res,403,{error:"Origine de la demande non autorisée."});
    if(Number(req.headers["content-length"])>config.limits.totalBytes+128*1024)return json(res,413,{error:"La taille maximale d’envoi est dépassée."});
    if(!await draftStorage.read(token))throw fail(404,"Ce brouillon n’existe plus : il a expiré ou il a déjà été envoyé.");
    const parsed=await parseMultipart(req,config.limits,["key"]);
    if(!parsed.uploads.length)throw fail(400,"Aucun document reçu.");
    for(const upload of parsed.uploads){
     if(!upload.name || upload.name.length>200 || /[\\/\r\n\u0000-\u001f\u007f]/.test(upload.name))throw fail(400,"Nom de fichier non accepté.");
     const contentType=detectedType(upload.content,upload.name);
     if(!upload.size || !contentType)throw fail(415,"Format ou contenu non accepté : "+upload.name);
     upload.contentType=contentType;
    }
    const result=await draftStorage.addFiles(token,parsed.fields.key,parsed.uploads,config.limits);
    return json(res,200,{files:result.files,added:result.added,expiresAt:result.expiresAt});
   }
   if(draftFile){
    if(req.method==="GET"){
     const found=await draftStorage.readFileContent(token,draftFile[1]);
     if(!found)return json(res,404,{error:"Document introuvable."});
     // Jamais rendu en ligne : le document repart vers le questionnaire, il n'est pas affiché par le navigateur.
     res.writeHead(200,{"Content-Type":found.entry.contentType,"Content-Length":found.content.length,"Cache-Control":"no-store","Content-Disposition":"attachment; filename=\"piece-"+found.entry.index+"\"","X-Content-Type-Options":"nosniff"});
     return res.end(found.content);
    }
    if(req.method==="DELETE"){
     if(req.headers.origin && req.headers.origin!==config.origin)return json(res,403,{error:"Origine de la demande non autorisée."});
     const result=await draftStorage.removeFile(token,draftFile[1]);
     return json(res,200,{files:result.files});
    }
    return json(res,405,{error:"Méthode non autorisée."});
   }
   if(route==="api/draft/link"){
    if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
    if(!transport)return json(res,503,{error:"L’envoi du lien par e-mail n’est pas configuré. Notez ou ajoutez cette page à vos favoris pour la retrouver."});
    const draft=await draftStorage.read(token);
    if(!draft)throw fail(404,"Ce brouillon n’existe plus : il a expiré ou il a déjà été envoyé.");
    const body=await readJson(req,4096);
    const email=typeof body?.email==="string"?body.email.trim():"";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length>200)throw fail(400,"Adresse e-mail invalide.");
    // Plafond par adresse ET par IP : le formulaire ne doit pas servir de relais de courrier.
    if(overLimit(draftLinkRates,email.toLowerCase(),DRAFT_LINK_MAX,DRAFT_LINK_WINDOW_MS) || overLimit(draftLinkRates,"ip:"+ip,DRAFT_LINK_MAX*4,DRAFT_LINK_WINDOW_MS))
     return json(res,429,{error:"Le lien a déjà été envoyé plusieurs fois à cette adresse aujourd’hui. Vérifiez votre boîte de réception, y compris les indésirables."});
    const resumeUrl=(config.origin||"")+config.basePath+"/"+draft.workflow+".html#r="+token;
    await sendTo(prepareResumeMail({email,firstName:draft.answers?.firstName||"",workflow:draft.workflow,resumeUrl,expiresAt:draft.expiresAt},config),email);
    return json(res,200,{ok:true});
   }
   if(req.method==="POST"){
    const body=await readJson(req,1024);
    const workflow=body?.workflow;
    if(!Object.hasOwn(workflows,workflow||""))throw fail(400,"Questionnaire inconnu.");
    if(overLimit(draftRates,"create:"+ip,DRAFT_CREATE_MAX,DRAFT_WINDOW_MS))return json(res,429,{error:"Trop de questionnaires ouverts depuis cette connexion. Réessayez dans quinze minutes."});
    const created=await draftStorage.create(workflow);
    return json(res,201,{token:created.token,draft:created.draft,draftDays:DRAFT_DAYS});
   }
   if(req.method==="GET"){
    const draft=await draftStorage.read(token);
    if(!draft)return json(res,404,{error:"Ce brouillon n’existe plus : il a expiré ou il a déjà été envoyé."});
    return json(res,200,{draft,draftDays:DRAFT_DAYS});
   }
   if(req.method==="PUT"){
    const body=await readJson(req,DRAFT_ANSWER_BYTES);
    if(!body || typeof body!=="object" || Array.isArray(body) || typeof body.answers!=="object" || !body.answers || Array.isArray(body.answers))throw fail(400,"Réponses illisibles.");
    if(!Number.isInteger(body.revision) || body.revision<0)throw fail(400,"Révision de brouillon invalide.");
    // Les réponses passent par le même nettoyage que l'envoi final : un brouillon ne peut pas contenir de clé inconnue.
    const draft=await draftStorage.save(token,{...body,answers:cleanAnswers(body.answers)},body.revision);
    return json(res,200,{draft});
   }
   if(req.method==="DELETE"){
    await draftStorage.remove(token);
    return json(res,200,{ok:true});
   }
   return json(res,405,{error:"Méthode non autorisée."});
  }catch(e){
   if(e.code==="DRAFT_CONFLICT")return json(res,409,{error:e.message,code:"DRAFT_CONFLICT"});
   return json(res,e.status||500,{error:e.status?e.message:"Le brouillon n’a pas pu être enregistré sur le serveur."});
  }
 }
 if(route.startsWith("api/admin/")){
  if(!auth.enabled)return json(res,503,{error:"Espace admin non configuré."});
 if(["POST","PATCH","PUT","DELETE"].includes(req.method) && !adminRequestAllowed(req))return json(res,403,{error:"Requête refusée : en-tête X-AEM-Admin manquant."});
 if(route==="api/admin/login" && req.method==="POST"){
 try{
 const ip=clientIp(req,config.trustProxy);
 const body=await readJson(req);
 if(typeof body!=="object" || !body)throw fail(400,"Corps de requête invalide.");
 const user=body.user===undefined || body.user===""?"admin":body.user;
 if(typeof user!=="string" || user.length>64 || typeof body.password!=="string")throw fail(400,"Identifiant ou mot de passe invalide.");
 // Plafond par IP et par identifiant connu ; même message dans les deux cas pour ne pas révéler l'existence d'un compte.
 if(!auth.loginAllowed(ip,user))return json(res,429,{error:"Trop de tentatives de connexion. Réessayez dans 15 minutes."});
 if(!auth.verifyPassword(user,body.password)){auth.recordLoginFailure(ip,user);return json(res,401,{error:"Identifiant ou mot de passe incorrect."});}
 auth.clearLoginFailures(ip,user);
 const token=auth.createSession(user);
 res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Set-Cookie":auth.sessionCookie(token,config.basePath||"/")});
 res.end(JSON.stringify({ok:true,user,role:auth.roleOf(user)}));
 }catch(e){json(res,e.status||400,{error:e.message||"Requête invalide."});}
 return;
 }
 if(route==="api/admin/logout" && req.method==="POST"){
 const session=requireAdmin(req,res);if(!session)return;
 auth.destroyToken(session.token);
 res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Set-Cookie":auth.clearCookie(config.basePath||"/")});
 res.end(JSON.stringify({ok:true}));
 return;
 }
 const session=requireAdmin(req,res);if(!session)return;
 if(route==="api/admin/status" && req.method==="GET"){
 if(session.role!=="responsable")return json(res,403,{error:"Réservé au compte responsable."});
 return json(res,200,{mail:Boolean(transport),candidateMail:Boolean(transport && config.candidateMail),ai:Boolean(config.aiEnabled),chat:await chat.summary(),retentionDays:config.retentionDays,accounts:auth.accountCount,user:session.user,dataDir:config.dataDir && config.dataDir!==".data"?"configuré":"par défaut",blobDriver:blobs?.driver||storage.fileStore?.driver||"legacy-fs"});
 }
 if(route==="api/admin/stats" && req.method==="GET"){
 const items=await storage.list();
 const today=dayOf(Date.now());
 return json(res,200,{
 total:items.length,
 received:items.filter(i=>i.status==="received").length,
 inProgress:items.filter(i=>i.status==="in_progress").length,
 missingPieces:items.filter(i=>i.status==="missing_pieces").length,
 toCollect:items.filter(i=>i.incomplete && i.status!=="archived").length,
 stale:items.filter(i=>typeof i.staleDays==="number" && i.staleDays>=STALE_AFTER_DAYS).length,
 unassigned:items.filter(i=>i.status==="received" && !i.assignedTo).length,
 today:items.filter(i=>i.createdAt && dayOf(i.createdAt)===today).length,
 ants:items.filter(i=>i.workflow==="ants").length,
 permis:items.filter(i=>i.workflow==="permis").length
 });
 }
 if(route==="api/admin/dossiers" && req.method==="GET"){
 // Sans filtre de statut, les dossiers classés sortent de la file ; status=archived les montre, status=all montre tout.
 const wanted=url.searchParams.get("status")||"";
 const items=(await storage.list({workflow:url.searchParams.get("workflow")||"",status:wanted==="all"?"":wanted,q:url.searchParams.get("q")||""}))
 .filter(i=>wanted||i.status!=="archived").map(i=>({...i,expiresAt:expiresAtOf(i)}));
 return json(res,200,{items,statuses:dossierStatuses});
 }
 const detail=route.match(/^api\/admin\/dossiers\/([a-f0-9-]+)$/);
 if(detail && req.method==="GET"){
 if(!isSubmissionId(detail[1]))return json(res,404,{error:"Dossier introuvable."});
 const meta=await storage.get(detail[1]);
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 const answers=meta.answers||{};
 const documents=documentsFor(answers,receivedAt(meta)).map(d=>({key:d.key,label:d.label,group:d.group,requiredUpload:Boolean(d.requiredUpload),fileCount:(meta.files||[]).filter(f=>f.key===d.key).length,deferred:isDeferred(answers,d.key)}));
 return json(res,200,{dossier:{...withWorkflowLabel(meta),expiresAt:expiresAtOf(meta)},documents,statuses:dossierStatuses});
 }
 const exportRoute=route.match(/^api\/admin\/dossiers\/([a-f0-9-]+)\/export$/);
 if(exportRoute && req.method==="GET"){
 if(!isSubmissionId(exportRoute[1]))return json(res,404,{error:"Dossier introuvable."});
 const meta=await storage.get(exportRoute[1]);
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 const documents=documentsFor(meta.answers||{},receivedAt(meta)).map(d=>({...d,fileCount:(meta.files||[]).filter(f=>f.key===d.key).length,deferred:isDeferred(meta.answers||{},d.key)}));
 res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
 return res.end(renderExport(withWorkflowLabel(meta),documents,{expiresAt:expiresAtOf(meta),by:session.user}));
 }
 if(detail && req.method==="DELETE"){
 // Effacement définitif (droit à l'effacement, dossier terminé) : réponses, fichiers, historique et reçu d'envoi.
 if(readOnly(session,res))return;
 if(!isSubmissionId(detail[1]))return json(res,404,{error:"Dossier introuvable."});
 const meta=await storage.get(detail[1]);
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 await storage.remove(detail[1]);
 await unlink(path.join(receiptRoot,detail[1]+".json")).catch(()=>{});
 console.log("Dossier supprimé par "+session.user+" : "+detail[1]);
 return json(res,200,{ok:true});
 }
 if(detail && req.method==="PATCH"){
 try{
 if(readOnly(session,res))return;
 if(!isSubmissionId(detail[1]))return json(res,404,{error:"Dossier introuvable."});
 const body=await readJson(req,32*1024);
 const patch=adminPatch(body);
 if(patch.assignedTo==="me")patch.assignedTo=session.user;
 const before=await storage.get(detail[1]);
 if(!before)return json(res,404,{error:"Dossier introuvable."});
 let meta=await storage.update(detail[1],patch,{by:session.user});
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 // Passage en « Prêt » : le candidat est prévenu que son dossier est complet et déposé (jamais bloquant).
 if(patch.status==="ready" && before.status!=="ready" && transport && config.candidateMail && meta.email){
 let details="Mail « dossier complet » envoyé à "+meta.email;
 try{await sendTo(prepareReadyMail(meta,config),meta.email);}catch(e){details="Échec du mail « dossier complet » à "+meta.email+" : "+(e.message||"erreur");}
 meta=await storage.update(meta.id,{},{by:session.user,action:"candidate_mail",details})||meta;
 }
 return json(res,200,{dossier:{...withWorkflowLabel(meta),expiresAt:expiresAtOf(meta)}});
 }catch(e){return json(res,e.status||400,{error:e.message||"Requête invalide."});}
 }
 const filesUpload=route.match(/^api\/admin\/dossiers\/([a-f0-9-]+)\/files$/);
 if(filesUpload && req.method==="POST"){
 // Pièce reçue au comptoir : mêmes contrôles de type et de taille que l'envoi du candidat.
 try{
 if(readOnly(session,res))return;
 if(!isSubmissionId(filesUpload[1]))return json(res,404,{error:"Dossier introuvable."});
 const meta=await storage.get(filesUpload[1]);
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 if(Number(req.headers["content-length"])>config.limits.totalBytes+128*1024)return json(res,413,{error:"La taille maximale d’envoi est dépassée."});
 const parsed=await parseMultipart(req,config.limits,["key"]);
 const documents=documentsFor(meta.answers||{},receivedAt(meta));
 const doc=documents.find(d=>d.key===parsed.fields.key);
 if(!doc)throw fail(400,"Pièce inconnue pour ce dossier.");
 if(!parsed.uploads.length)throw fail(400,"Aucun fichier reçu.");
 for(const upload of parsed.uploads){
 if(!upload.name || upload.name.length>200 || /[\\/\r\n\u0000-\u001f\u007f]/.test(upload.name))throw fail(400,"Nom de fichier non accepté.");
 const contentType=detectedType(upload.content,upload.name);
 if(!upload.size || !contentType)throw fail(415,"Format ou contenu non accepté : "+upload.name);
 upload.contentType=contentType;
 }
 const updated=await storage.addFiles(meta.id,doc.key,parsed.uploads,{by:session.user,label:doc.label});
 const docs=documentsFor(updated.answers||{},receivedAt(updated)).map(d=>({key:d.key,label:d.label,group:d.group,requiredUpload:Boolean(d.requiredUpload),fileCount:(updated.files||[]).filter(f=>f.key===d.key).length,deferred:isDeferred(updated.answers||{},d.key)}));
 return json(res,200,{dossier:{...withWorkflowLabel(updated),expiresAt:expiresAtOf(updated)},documents:docs});
 }catch(e){return json(res,e.status||400,{error:e.message||"Requête invalide."});}
 }
 const request=route.match(/^api\/admin\/dossiers\/([a-f0-9-]+)\/request$/);
 if(request && req.method==="POST"){
 try{
 if(readOnly(session,res))return;
 if(!isSubmissionId(request[1]))return json(res,404,{error:"Dossier introuvable."});
 const meta=await storage.get(request[1]);
 if(!meta)return json(res,404,{error:"Dossier introuvable."});
 const body=await readJson(req,32*1024);
 const {pieces,message}=requestBody(body,documentsFor(meta.answers||{},receivedAt(meta)));
 // Anti double clic : pas deux demandes à moins de 60 s d'intervalle pour le même dossier.
 const lastRequest=(meta.history||[]).filter(e=>e.action==="request").at(-1);
 if(lastRequest && Date.now()-new Date(lastRequest.at).getTime()<60*1000)return json(res,409,{error:"Une demande vient d’être envoyée pour ce dossier."});
 if(!transport || !config.from)return json(res,503,{error:"Messagerie non configurée : la demande ne peut pas être envoyée au candidat."});
 if(!meta.email)return json(res,400,{error:"Ce dossier ne comporte pas d’adresse e-mail."});
 try{await sendTo(prepareRequestMail(meta,pieces,message,config),meta.email);}
 catch(e){return json(res,502,{error:"L’e-mail n’a pas pu être envoyé au candidat ; le statut du dossier n’a pas été modifié."+(e.status?" "+e.message:"")});}
 const details="Pièces demandées à "+meta.email+" : "+pieces.map(d=>d.label).join(", ")+(message?" — Message : "+message:"");
 const updated=await storage.update(meta.id,{status:"missing_pieces"},{by:session.user,action:"request",details});
 return json(res,200,{dossier:withWorkflowLabel(updated)});
 }catch(e){return json(res,e.status||400,{error:e.message||"Requête invalide."});}
 }
 const fileRoute=route.match(/^api\/admin\/dossiers\/([a-f0-9-]+)\/files\/(\d+)$/);
 if(fileRoute && req.method==="GET"){
 if(!isSubmissionId(fileRoute[1]))return json(res,404,{error:"Fichier introuvable."});
 const item=await storage.readFileContent(fileRoute[1],fileRoute[2]);
 if(!item)return json(res,404,{error:"Fichier introuvable."});
 const download=url.searchParams.has("download");
 const filename=encodeURIComponent(item.file.name).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
 res.writeHead(200,{"Content-Type":item.file.contentType,"Content-Length":item.content.length,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Disposition":(download?"attachment":"inline")+"; filename*=UTF-8''"+filename});
 res.end(item.content);return;
 }
 return json(res,404,{error:"Route admin introuvable."});
 }
 if(demo && demo.handle(req,res,route))return;
 if(demo && req.method==="GET" && route==="demo.css"){
 res.writeHead(200,{"Content-Type":"text/css; charset=utf-8"});res.end(await readFile(path.join(root,"demo.css")));return;
 }
 if(req.method==="GET" && publicFiles.has(route)){
 try{
 const name=publicFiles.get(route);
 if(route.startsWith("admin") && !auth.enabled)return json(res,404,{error:"Page introuvable."});
 res.writeHead(200,{"Content-Type":mime[path.extname(name)],"Cache-Control":"no-cache"});res.end(await readFile(path.join(root,name)));
 }catch{json(res,500,{error:"Fichier indisponible."});}
 return;
 }
 // Livraison : une archive complète du site déposée dans livraison/ est téléchargeable par toute personne qui connaît son adresse exacte.
 const delivery=route.match(/^telechargement\/([a-z0-9][a-z0-9._-]{0,120}\.zip)$/i);
 if(!config.standalone && delivery && req.method==="GET" && !delivery[1].includes("..")){
 try{
 const file=path.join(root,"livraison",delivery[1]);
 const info=await stat(file);
 res.writeHead(200,{"Content-Type":"application/zip","Content-Length":info.size,"Cache-Control":"no-store","Content-Disposition":'attachment; filename="'+delivery[1]+'"'});
 return res.end(await readFile(file));
 }catch(e){if(e.code!=="ENOENT" && e.code!=="EISDIR" && e.code!=="ENOTDIR")throw e;return json(res,404,{error:"Fichier introuvable."});}
 }
 // Photos de l'école (photos/) et phrases enregistrées de l'assistant (voice/) : fichiers déposés par AEM, servis s'ils existent.
 const media=route.match(/^(photos|voice)\/([a-z0-9][a-z0-9._-]{0,80}\.(?:jpe?g|png|webp|mp3|ogg|m4a|json))$/i);
 if(!config.standalone && media && req.method==="GET" && !media[2].includes("..")){
 try{
 const content=await readFile(path.join(root,media[1],media[2]));
 res.writeHead(200,{"Content-Type":mime[path.extname(media[2]).toLowerCase()],"Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff"});
 return res.end(content);
 }catch(e){if(e.code!=="ENOENT" && e.code!=="EISDIR" && e.code!=="ENOTDIR")throw e;return json(res,404,{error:"Fichier introuvable."});}
 }
 if(route!=="api/submit"){
 if(req.method==="GET" && (req.headers.accept||"").includes("text/html")){
 res.writeHead(404,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
 return res.end('<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page introuvable — Auto-école Majolane</title><link rel="stylesheet" href="'+config.basePath+'/styles.css"></head><body><main class="app-shell"><section class="question-card"><div class="step-content"><p class="eyebrow">Erreur 404</p><h1>Page introuvable</h1><p class="lead">Cette adresse ne correspond à aucune page du site de l’Auto-école Majolane.</p><a class="next-button" href="'+config.basePath+'/">Retour à l’accueil</a></div></section></main></body></html>');
 }
 return json(res,404,{error:"Page introuvable."});
 }
 if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
 if(!enabled)return json(res,503,{error:"L’envoi n’est pas encore configuré sur l’hébergement AEM. Aucun document n’a été transmis."});
 if(req.headers.origin!==config.origin || req.headers["x-aem-request"]!=="questionnaire")return json(res,403,{error:"Origine de la demande non autorisée."});
 const ip=clientIp(req,config.trustProxy),now=Date.now();
 for(const [key,r] of rates)if(r.until<now)rates.delete(key);
 // Compteur débité avant traitement (anti-flood de gros corps) puis recrédité sur succès : seuls les échecs consomment durablement le quota (session collective sur un même Wi-Fi).
 const rate=rates.get(ip)||{count:0,until:now+15*60*1000};rate.count++;rates.set(ip,rate);
 const credit=()=>{rate.count=Math.max(0,rate.count-1);};
 if(rate.count>20)return json(res,429,{error:"Trop de tentatives. Réessayez dans 15 minutes."});
 if(active>=2)return json(res,503,{error:"Le service est occupé. Gardez cet onglet ouvert et réessayez."});
 if(Number(req.headers["content-length"])>config.limits.totalBytes+128*1024)return json(res,413,{error:"La taille maximale d’envoi est dépassée."});
 active++;let id,sendStarted=false,ownsLock=false,stored=false;
 try{
 const parsed=await parseMultipart(req,config.limits);
 const submission=validatedSubmission(parsed.fields,parsed.uploads,config.limits);
 id=submission.submissionId;
 if(demo){
 // Démonstration : aperçu du mail dans /test-audit, et le dossier entre aussi dans l'espace admin quand un stockage est configuré.
 if(storageEnabled){
 const deferred=deferredDocuments(submission.answers,submission.uploads);
 await storage.save(submission,auditText(submission.answers,submission.uploads),{incomplete:deferred.length>0,deferredCount:deferred.length});
 }
 await consumeDraft(req);
 const mail=prepareMail(submission,config);const redirect=demo.save(submission,mail);json(res,200,{ok:true,submissionId:id,demo:true,redirect});credit();return;
 }
 const hash=createHash("sha256").update(JSON.stringify(submission.answers));
 for(const f of submission.uploads)hash.update(f.key).update(f.name).update(f.content);
 const fingerprint=hash.digest("hex");
 if(inflight.has(id))throw fail(409,"Cet envoi est déjà en cours. Patientez avant de réessayer.");
 inflight.add(id);ownsLock=true;
 const previous=await receipt(id);
 if(previous){
 if(previous.fingerprint!==fingerprint)throw fail(409,"Cette référence correspond à un autre envoi.");
 if(previous.status==="accepted"){await consumeDraft(req);json(res,200,{ok:true,submissionId:id});credit();return;}
 throw fail(409,"La confirmation de cet envoi est incertaine. Contactez AEM avec la référence "+id+" avant un nouvel envoi.");
 }
 const audit=auditText(submission.answers,submission.uploads);
 const deferred=deferredDocuments(submission.answers,submission.uploads);
 await storage.save(submission,audit,{incomplete:deferred.length>0,deferredCount:deferred.length});stored=true;
 await record(id,{fingerprint,status:"accepted",createdAt:new Date().toISOString(),stored:true});
 let notifyError=null;
 if(transport){
 sendStarted=true;
 try{await sendTo(prepareMail(submission,config,{adminUrl:adminBase,attachments:config.mailAttachments}),config.recipient);}catch(e){notifyError=e;}
 }
 await acknowledgeCandidate(submission);
 await consumeDraft(req);
 if(notifyError)throw notifyError;
 if(config.retentionDays>0)storage.purgeOlderThan(config.retentionDays).catch(()=>{});
 json(res,200,{ok:true,submissionId:id});credit();
 }catch(e){
 const status=e.status||502;
 json(res,status,{ok:false,error:sendStarted && stored?"Le dossier est enregistré mais la notification e-mail a échoué. Consultez l’espace admin ou contactez AEM avec la référence "+id+".":stored?e.message:e.status?e.message:"L’envoi n’a pas pu être préparé. Gardez cet onglet ouvert et réessayez plus tard."});
 }finally{active--;if(ownsLock)inflight.delete(id);}
 }
 // Filet global : aucune exception ni rejet d'une requête ne doit arrêter le processus.
 const server=http.createServer(async(req,res)=>{
 try{await handle(req,res);}
 catch(e){
 console.error("Erreur serveur",req.method,req.url,e);
 if(!res.headersSent)json(res,500,{error:"Erreur interne."});
 else if(!res.writableEnded)res.destroy();
 }
 });
 server.requestTimeout=120000;server.headersTimeout=15000;
 // Conservation : purge au démarrage puis une fois par jour, dossiers, reçus d'envoi et brouillons abandonnés ; jamais bloquante.
 const purgesDossiers=storageEnabled && config.retentionDays>0 && !options.storage;
 if(purgesDossiers || draftStorage){
 const purge=async()=>{
 try{
 const removed=purgesDossiers?await storage.purgeOlderThan(config.retentionDays):0;
 const cutoff=Date.now()-config.retentionDays*86400000;let receipts=0;
 for(const name of purgesDossiers?await readdir(receiptRoot).catch(()=>[]):[]){
 if(!name.endsWith(".json"))continue;
 const file=path.join(receiptRoot,name),info=await stat(file).catch(()=>null);
 if(info && info.mtimeMs<cutoff){await unlink(file).catch(()=>{});receipts++;}
 }
   const drafts=draftStorage?await draftStorage.purgeExpired().catch(()=>0):0;
   if(removed || receipts || drafts)console.log("Conservation : "+removed+" dossier(s), "+receipts+" reçu(s) et "+drafts+" brouillon(s) effacés.");
   }catch(e){console.error("Purge impossible",e);}
  };
 purge();
 const timer=setInterval(purge,24*60*60*1000);timer.unref();
 server.on("close",()=>clearInterval(timer));
 }
 return server;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 // Filet supplémentaire en production seulement (les tests gardent le comportement par défaut de Node pour repérer les bugs).
 process.on("unhandledRejection",e=>console.error("Rejet non géré",e));
 const blobs=await createBlobStoreFromConfig(defaultConfig);
 if(blobs?.driver==="r2")console.log("Stockage fichiers : Cloudflare R2 (bucket privé).");
 createApp({blobs}).listen(defaultConfig.port,defaultConfig.host,()=>console.log("Questionnaire AEM : http://"+defaultConfig.host+":"+defaultConfig.port+defaultConfig.basePath+"/"));
}
