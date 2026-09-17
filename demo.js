// Présentation locale uniquement : données et octets temporaires en mémoire.
import {randomUUID} from "node:crypto";
import {formatDate,documentsFor} from "./logic.js";
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const size=n=>(n/1024).toLocaleString("fr-FR",{maximumFractionDigits:1})+" Ko";
export function createDemo(basePath=""){
 const dossiers=new Map(),prefix=basePath+"/";
 const shell=(title,body)=>'<!doctype html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+' — AEM</title><link rel="stylesheet" href="'+prefix+'styles.css"><link rel="stylesheet" href="'+prefix+'demo.css"></head><body><main class="audit-shell"><header class="demo-header"><img src="'+prefix+'cropped-logo_auto-ecole-meyzieu.png" alt="AEM"><span>Auto-école Majolane</span><span class="demo-badge">Démonstration locale · aucun email envoyé</span></header>'+body+'</main></body></html>';
 const reply=(res,status,html)=>{res.writeHead(status,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});res.end(html);};
 function purge(){for(const [id,item] of dossiers)if(item.until<Date.now())dossiers.delete(id);}
 return {
 save(submission,mail){
 purge();while(dossiers.size>=5)dossiers.delete(dossiers.keys().next().value);
 const id=randomUUID();dossiers.set(id,{submission,mail,until:Date.now()+60*60*1000});
 return prefix+"test-audit/"+id;
 },
 handle(req,res,route){
 if(req.method!=="GET" || !route.startsWith("test-audit"))return false;
 purge();
 if(route==="test-audit" || route==="test-audit/"){
 reply(res,200,shell("Questionnaires tests",'<h1>Questionnaires tests</h1><p class="lead">Remplissez une démarche, ajoutez vos documents puis cliquez sur Envoyer. Une nouvelle page présentera le contenu du mail administratif.</p><div class="demo-start"><a class="next-button" href="'+prefix+'ants.html">Questionnaire ANTS</a><a class="next-button" href="'+prefix+'permis.html">Questionnaire Permis</a></div><p class="validation-hint">Les fichiers sont réellement reçus par ce serveur local. Aucun email n’est envoyé. Utilisez des documents fictifs. Les aperçus disparaissent après une heure, après cinq nouveaux dossiers ou à l’arrêt du serveur.</p>'));
 return true;
 }
 const match=route.match(/^test-audit\/([a-f0-9-]+)(?:\/files\/(\d+))?$/),item=match&&dossiers.get(match[1]);
 if(!item){reply(res,404,shell("Aperçu indisponible",'<h1>Aperçu indisponible</h1><p class="lead">Ce dossier de démonstration a expiré ou le serveur a été redémarré.</p><a href="'+prefix+'test-audit">Recommencer un test</a>'));return true;}
 const {submission,mail}=item;
 if(match[2]!==undefined){
 const file=submission.uploads[Number(match[2])];
 if(!file){reply(res,404,shell("Fichier indisponible","<h1>Fichier indisponible</h1>"));return true;}
 const download=new URL(req.url,"http://localhost").searchParams.has("download");
 const filename=encodeURIComponent(file.name).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
 res.writeHead(200,{"Content-Type":file.contentType,"Content-Length":file.size,"Cache-Control":"no-store","Content-Disposition":(download?"attachment":"inline")+"; filename*=UTF-8''"+filename});res.end(file.content);return true;
 }
 const a=submission.answers,type=a.workflow==="ants"?"Dossier ANTS":"Fabrication du permis";
 const info=[["Nom",a.birthName],["Prénom",a.firstName],["Date de naissance",formatDate(a.birthDate)],["Nationalité",a.nationality==="francaise"?"Française":"Étrangère"],["Téléphone",a.phone],["Email",a.email]];
 const groups=documentsFor(a).map(doc=>{
 const files=submission.uploads.map((f,index)=>({...f,index})).filter(f=>f.key===doc.key);
 if(!files.length)return "";
 return '<section class="demo-document-group"><h3>'+escape(doc.label)+' <span class="file-count">'+files.length+' fichier(s)</span></h3><ul class="demo-files">'+files.map(f=>{
 const href=prefix+"test-audit/"+match[1]+"/files/"+f.index;
 return '<li><div><strong>'+escape(f.name)+'</strong><small>'+escape(f.contentType)+' · '+size(f.size)+'</small></div><div class="file-actions"><a target="_blank" rel="noopener" href="'+href+'">Ouvrir</a><a href="'+href+'?download=1">Télécharger</a></div></li>';
 }).join("")+'</ul></section>';
 }).join("");
 reply(res,200,shell("Aperçu de l’audit administratif",'<p class="eyebrow">'+type+'</p><h1>Aperçu de l’audit administratif</h1><p class="lead">Voici le contenu du mail que recevrait l’administration, accompagné des fichiers originaux transmis.</p><section class="demo-panel"><h2>Informations du candidat</h2><dl class="candidate-info">'+info.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escape(value)+'</dd></div>').join("")+'</dl></section><section class="demo-panel"><h2>Audit administratif complet</h2><div class="mail-envelope"><p><strong>Destinataire :</strong> '+escape(mail.to)+'</p><p><strong>Objet :</strong> '+escape(mail.subject)+'</p></div><pre id="audit-body">'+escape(mail.text)+'</pre></section><section class="demo-panel"><h2>Documents transmis <span class="file-count">'+submission.uploads.length+' fichier(s)</span></h2>'+groups+'</section><p class="validation-hint">Fichiers reçus pour la démonstration, à vérifier par l’administration. Aucun document n’a été déclaré conforme.</p><a class="demo-return" href="'+prefix+'test-audit">Revenir aux questionnaires tests</a>'));
 return true;
 }
 };
}
