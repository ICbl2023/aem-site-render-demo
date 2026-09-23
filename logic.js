// Source métier : les trois XMind et décisions du responsable du 10/09/2026.
// Aucune validation de conformité administrative n'est effectuée ici.
export const workflows = {ants:"ANTS", permis:"Permis"};
export function newSubmissionId(source=globalThis.crypto){
 if(source && typeof source.randomUUID==="function")return source.randomUUID();
 if(!source || typeof source.getRandomValues!=="function")throw new Error("Ce navigateur ne permet pas de préparer un envoi. Ouvrez le questionnaire dans Safari, Chrome ou Edge à jour.");
 const bytes=new Uint8Array(16);source.getRandomValues(bytes);
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
 return hex.slice(0,8)+"-"+hex.slice(8,12)+"-"+hex.slice(12,16)+"-"+hex.slice(16,20)+"-"+hex.slice(20);
}
export const limits = {fileBytes:10*1024*1024, totalBytes:17*1024*1024, fileCount:30};
export const acceptedExtensions = ["pdf","jpg","jpeg","png","heic","heif","webp"];
export const accept = acceptedExtensions.map(x=>"."+x).join(",")+",image/*,application/pdf";
export const yesNo = [["oui","Oui"],["non","Non"]];
export const identities = {
 francaise:[["cni_fr","Carte nationale d’identité française"],["passeport_fr","Passeport français"]],
 // Mention pratique sous la CNI européenne (plus de six mois). Pas de définition juridique longue.
 etrangere:[["sejour","Titre de séjour français"],["cni_europe","Carte d’identité d’un pays européen","Vous devez avoir séjourné plus de 6 mois sur le territoire français."],["passeport_etranger","Passeport étranger"]]
};
export function dateParts(value) {
 if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
 const [y,m,d]=value.split("-").map(Number);
 if(y<1 || m<1 || m>12 || d<1) return null;
 const dt=new Date(0); dt.setUTCFullYear(y,m-1,d); dt.setUTCHours(0,0,0,0);
 return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d ? {y,m,d,time:dt.getTime()} : null;
}
export function todayISO(now=new Date()) {
 return new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
export function ageFromDate(value, now=new Date()) {
 const b=dateParts(value),t=dateParts(todayISO(now));
 if(!b || b.time>t.time) return null;
 return t.y-b.y-(t.m<b.m || (t.m===b.m && t.d<b.d)?1:0);
}
export function isMinor(a,now=new Date()){const age=ageFromDate(a.birthDate,now);return age!==null && age<18;}
export function maskDate(value,type="date",caret=value.length){
 // Jour ou mois à un chiffre validé par une barre (« 5/3/2004 », collage compris) : complété par un zéro.
 const segments=type==="month"?1:2;
 const pad=v=>v.split("/").map((s,i,a)=>i<segments && i<a.length-1 && /^\d$/.test(s)?"0"+s:s).join("/");
 const before=pad(value.slice(0,caret));value=pad(value);
 const max=type==="month"?6:8,digits=value.replace(/\D/g,"").slice(0,max);
 const count=Math.min(before.replace(/\D/g,"").length,digits.length);
 let text="",position=0;
 for(let i=0;i<digits.length;i++){
 text+=digits[i];
 if(i===1 || (type!=="month" && i===3))text+="/";
 if(i+1===count)position=text.length;
 }
 return {text,caret:position};
}
export function dateFromInput(value,type="date"){
 let text=value.trim();
 if(type==="month" && /^\d{6}$/.test(text))text=text.slice(0,2)+"/"+text.slice(2);
 if(type!=="month" && /^\d{8}$/.test(text))text=text.slice(0,2)+"/"+text.slice(2,4)+"/"+text.slice(4);
 const pattern=type==="month"?/^(\d{1,2})\/(\d{4})$/:/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
 const match=text.match(pattern);
 if(!match)return text;
 return type==="month"?match[2]+"-"+match[1].padStart(2,"0"):match[3]+"-"+match[2].padStart(2,"0")+"-"+match[1].padStart(2,"0");
}
export function dateInputValue(value,type="date"){
 return (type==="month"?monthParts(value):dateParts(value))?value.split("-").reverse().join("/"):value||"";
}
export function formatDate(value) {const p=dateParts(value);return p?value.split("-").reverse().join("/"):"Non renseignée ou invalide";}
function monthAnchor(p,months) {
 const index=p.y*12+p.m-1+months,y=Math.floor(index/12),m=index%12+1;
 const end=new Date(0);end.setUTCFullYear(y,m,0);end.setUTCHours(0,0,0,0);
 return dateParts(String(y).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(Math.min(p.d,end.getUTCDate())).padStart(2,"0"));
}
export function expiryStatus(value,now=new Date()) {
 const e=dateParts(value),t=dateParts(todayISO(now));
 if(!e) return {status:"À vérifier",detail:value?"Date d’expiration invalide":"Date d’expiration non renseignée"};
 if(e.time<t.time) return {status:"Expiré",detail:"Expiré le "+formatDate(value)};
 if(e.time===t.time) return {status:"Valide",detail:"Expire aujourd’hui"};
 let months=(e.y-t.y)*12+e.m-t.m;
 if(monthAnchor(t,months).time>e.time) months--;
 const days=Math.round((e.time-monthAnchor(t,months).time)/86400000);
 const years=Math.floor(months/12),parts=[];
 if(years)parts.push(years+" an"+(years>1?"s":""));
 if(months%12)parts.push(months%12+" mois");
 if(days)parts.push(days+" jour"+(days>1?"s":""));
 return {status:"Valide",detail:"Validité restante : "+parts.join(" et ")};
}
export function monthParts(value){
 if(typeof value!=="string" || !/^\d{4}-\d{2}$/.test(value))return null;
 const [y,m]=value.split("-").map(Number);
 return y>=1 && m>=1 && m<=12?{y,m}:null;
}
export function formatMonth(value){return monthParts(value)?value.split("-").reverse().join("/"):"Non renseigné ou invalide";}
export function yearParts(value){
 if(typeof value!=="string" || !/^\d{4}$/.test(value))return null;
 const y=Number(value);
 return y>=1000 && y<=9999?{y}:null;
}
export function formatYear(value){return yearParts(value)?value:"Non renseignée ou invalide";}
export function yearAge(value,now=new Date()){
 const d=yearParts(value),t=dateParts(todayISO(now));
 if(!d)return value?"Année du document invalide":"Année du document non renseignée";
 if(d.y>t.y)return "Année du document dans le futur";
 if(d.y===t.y)return "Document de l’année en cours";
 return "Ancienneté en années civiles : "+(t.y-d.y)+" an"+(t.y-d.y>1?"s":"")+".";
}
export function monthAge(value,now=new Date()){
 const d=monthParts(value),t=dateParts(todayISO(now));
 if(!d)return value?"Mois du document invalide":"Mois du document non renseigné";
 const months=(t.y-d.y)*12+t.m-d.m;
 if(months<0)return "Mois du document dans le futur";
 if(months===0)return "Document du mois en cours";
 return "Ancienneté en mois calendaires : "+months+" mois.";
}
export function documentAge(value,now=new Date()){
 const d=dateParts(value),t=dateParts(todayISO(now));
 if(!d)return value?"Date du document invalide":"Date du document non renseignée";
 if(d.time>t.time)return "Date du document dans le futur";
 if(d.time===t.time)return "Document daté d’aujourd’hui";
 let months=(t.y-d.y)*12+t.m-d.m;
 if(monthAnchor(d,months).time>t.time)months--;
 const days=Math.round((t.time-monthAnchor(d,months).time)/86400000),years=Math.floor(months/12),parts=[];
 if(years)parts.push(years+" an"+(years>1?"s":""));
 if(months%12)parts.push(months%12+" mois");
 if(days)parts.push(days+" jour"+(days>1?"s":""));
 return "Ancienneté : "+parts.join(" et ");
}
const field=(key,label,type="text",required=true,options)=>({key,label,type,required,options});
const choice=(key,label,options=yesNo,required=true)=>field(key,label,"choice",required,options);
const step=(id,title,group,fields=[],extra={})=>({id,title,group,fields,...extra});
export function stepsFor(a) {
 const flow=a.workflow;
 const s=[
 step("identity","Qui êtes-vous ?","Identité",[field("birthName","Nom de naissance"),field("firstName","Prénom"),field("birthDate","Date de naissance","birthdate",true)],{hint:"L’âge est calculé automatiquement pour adapter vos documents."}),
 step("coordinates","Comment vous joindre ?","Coordonnées",[field("phone","Ton téléphone","tel"),field("email","Ton email","email")],{hint:"Les coordonnées du candidat sont demandées quel que soit son âge."}),
 step("nationality","Quelle est votre nationalité ?","Identité",[choice("nationality","Nationalité",[["francaise","Française"],["etrangere","Étrangère"]])])
 ];
 s.push(step("identityDocument","Quel document d’identité possédez-vous ?","Identité",[choice("identityDocument","Document d’identité",identities[a.nationality]||[])]));
 if(a.identityDocument==="cni_europe"){
 s.push(step("europeSituation","Quelle est votre situation en France ?","Votre situation",[choice("europeSituation","Situation",[["student","Étudiant(e)"],["worker","Salarié(e)"]])],{hint:"Selon votre situation, un justificatif complémentaire sera demandé en plus de votre carte d’identité européenne. Ce choix n’est pas une validation automatique."}));
 }
 s.push(step("identityFiles","Ajoutez votre document d’identité","Documents",[field("identityExpiry","Date d’expiration","date",false)],{documentGroup:"identity",hint:"Ajoutez les faces utiles, en plusieurs fichiers si besoin. AEM contrôlera le document ; la date seule ne prouve pas sa conformité."}));
 if(a.identityDocument==="cni_europe" && (a.europeSituation==="student" || a.europeSituation==="worker")){
  s.push(step("europeResidence",a.europeSituation==="student"?"Ajoutez votre justificatif de scolarité":"Ajoutez votre fiche de paie","Votre situation",[],{documentGroup:"europeResidence",hint:"Joignez le document demandé. AEM l’examinera avec les autres pièces ; il ne vaut pas validation automatique."}));
 }
 if(ageDocuments(a).length)s.push(step("ageFiles","Vos justificatifs liés à l’âge","Documents",[],{documentGroup:"age",hint:"Ajoutez les documents dont vous disposez. Si une pièce manque, AEM verra avec vous."}));
 if(isMinor(a))s.push(step("contact","Une personne à contacter en cas de besoin","Coordonnées",[field("contactName","Nom et prénom du responsable","text",true),field("contactPhone","Téléphone du responsable","tel",true),field("contactEmail","E-mail du responsable (facultatif)","email",false)],{hint:"Pour un mineur, indiquez le parent ou le responsable légal à contacter."}));
 s.push(step("home","Quelle est votre situation ?","Domicile",[choice("home","Situation",[["parents","Hébergé(e) chez mes parents"],["own","Justificatif à mon nom"]])],{hint:"Si aucune situation ne correspond, contactez AEM avant de poursuivre."}));
 // Justificatif de domicile différé : le type et la date ne bloquent plus (AEM récupère la pièce).
 const homeDeferred=isDeferred(a,"home_"+a.home);
 const homeProofField=choice("homeProof","Type de justificatif",[
  ["facture","Facture d’abonnement de moins de 6 mois"],
  ["loyer","Quittance de loyer de moins de 6 mois"],
  ["impot","Dernier avis d’imposition"]
 ],!homeDeferred);
 // Avis d’imposition : année seule. Facture / quittance : mois + année (< 6 mois).
 const homeDateField=a.homeProof==="impot"
  ?{...field("homeDate","Année du document","year",!homeDeferred),documentDate:true}
  :{...field("homeDate","Mois et année du document","month",!homeDeferred),documentDate:true,maxMonths:6};
 const homeHint=a.homeProof==="impot"
  ?"Joignez votre dernier avis d’imposition et indiquez son année. Un seul type de justificatif suffit. Avis de prélèvement et attestation de contrat ne sont pas acceptés dans ce parcours."
  :"Joignez un justificatif de moins de 6 mois. Indiquez le mois et l’année du document. Un seul type suffit. Avis de prélèvement et attestation de contrat ne sont pas acceptés dans ce parcours.";
 s.push(step("homeFiles","Votre justificatif de domicile","Domicile",[homeProofField,homeDateField],{documentGroup:"home",hint:homeHint}));
 if(flow==="ants"){
 s.push(step("special","Votre situation nécessite-t-elle un justificatif particulier ?","Compléments",[choice("special","Justificatif particulier")],{hint:"Répondez selon les indications dont vous disposez. AEM confirmera les pièces nécessaires ; ne détaillez pas de diagnostic médical."}));
 if(a.special==="oui")s.push(step("specialFiles","Quel justificatif particulier devez-vous transmettre ?","Compléments",[choice("specialReason","Situation",[["medical","Visite médicale nécessaire"],["handicap","Situation de handicap / affection"],["existing","Permis ou examen déjà existant"],["other","Autre situation particulière"]])],{documentGroup:"special",hint:"Ajoutez le document correspondant à votre situation ou demandé par ANTS."}));
 }
 if(flow==="permis"){
 s.push(step("medical","Une visite médicale est-elle nécessaire ?","Compléments",[choice("medical","Visite médicale nécessaire")],{hint:"Répondez selon les indications reçues. Le questionnaire ne détermine pas cette nécessité."}));
 if(a.medical==="oui")s.push(step("medicalFiles","Ajoutez l’avis médical","Compléments",[],{documentGroup:"medical"}));
 }
 s.push(step("summary","Vérifiez votre récapitulatif","Récapitulatif"));
 return s;
}
export function needsJdc(a,now=new Date()){
 // Français : JDC de 17 ans inclus à 24 ans inclus (pas à 16, pas à 25+). Étrangers : jamais.
 const age=ageFromDate(a.birthDate,now);
 return a.nationality==="francaise" && age!==null && age>=17 && age<25;
}
export function ageDocuments(a,now=new Date()){
 const age=ageFromDate(a.birthDate,now),d=[];
 if(age===15)d.push({key:"assr_15",label:"ASSR 2 / à défaut ASSR 1",group:"age"});
 if(age>=16 && age<=21)d.push({key:"assr_2",label:"ASSR 2",group:"age"});
 if(a.nationality==="francaise" && age===17)d.push({key:"recensement",label:"Recensement",group:"age"});
 if(needsJdc(a,now))d.push({key:"jdc",label:"JDC ou avis de situation",group:"age"});
 return d;
}
export function identityLabel(a){return (identities[a.nationality]||[]).find(x=>x[0]===a.identityDocument)?.[1]||"Pièce d’identité";}
export function documentsFor(a,now=new Date()){
 const d=[{key:"identity_"+(a.identityDocument||"missing"),label:identityLabel(a),group:"identity",requiredUpload:true}];
 // deferrable : le candidat peut indiquer ne pas avoir la pièce sous la main ; AEM la récupère ensuite.
 // Jamais différable : le document d’identité.
 d.push(...ageDocuments(a,now).map(doc=>({...doc,requiredUpload:true,deferrable:true})));
 if(a.identityDocument==="cni_europe" && (a.europeSituation==="student" || a.europeSituation==="worker")){
 const label=a.europeSituation==="student"?"Bulletin scolaire datant d’il y a six mois, ou justificatif / attestation de scolarité":"Fiche de paie de plus de six mois";
 d.push({key:"europe_residence",label,group:"europeResidence",requiredUpload:true});
 }
 if(a.home){
 d.push({key:"home_"+a.home,label:a.home==="parents"?"Justificatif de domicile du parent / responsable (moins de 6 mois)":"Justificatif de domicile à votre nom (moins de 6 mois)",group:"home",requiredUpload:true,deferrable:true});
 if(a.home==="parents")d.push({key:"hosting",label:"Attestation d’hébergement datée d’aujourd’hui",group:"home",requiredUpload:true,deferrable:true,hint:"Le modèle d’attestation est fourni dans le mail : remplissez-le aujourd’hui, puis joignez-le ici."},{key:"parent_identity",label:"Pièce d’identité du parent / responsable",group:"home",requiredUpload:true,deferrable:true});
 }
 if(a.workflow==="ants" && a.special==="oui" && a.specialReason)d.push({key:"special_"+a.specialReason,label:a.specialReason==="medical"?"Avis médical":"Justificatif particulier correspondant à la situation / demandé par ANTS",group:"special",requiredUpload:true,deferrable:true});
 if(a.workflow==="permis" && a.medical==="oui")d.push({key:"medical",label:"Avis médical",group:"medical",requiredUpload:true,deferrable:true});
 return d;
}
/** Libellé Admin (affichage) : ne modifie pas le questionnaire ni les clés techniques. */
export function adminDocumentLabel(doc,answers={}){
 if(!doc)return "";
 if(doc.key==="europe_residence" && answers.europeSituation==="worker"){
  // Demande métier : remplacer « fiche de paie » dans l’Admin, sans fusionner avec home_*.
  return "Justificatif de domicile (situation Europe — activité professionnelle)";
 }
 return doc.label;
}
export function deferredKeys(a){return Array.isArray(a.deferred)?a.deferred.filter(k=>typeof k==="string"):[];}
export function isDeferred(a,key){return deferredKeys(a).includes(key);}
export function deferredDocuments(a,files=[],now=new Date()){
 return documentsFor(a,now).filter(d=>d.deferrable && isDeferred(a,d.key) && !files.some(f=>f.key===d.key));
}
const nameFields=["birthName","firstName","contactName"];
export function fieldError(f,value,now=new Date()){
 if(typeof value!=="string")value="";
 if(!value.trim())return f.required?"Renseignez ce champ.":"";
 if(value.length> (f.type==="textarea"?2000:200))return "Ce texte est trop long.";
 if(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value) || (f.type!=="textarea" && /[\t\r\n]/.test(value)))return "Caractère non autorisé.";
 // Champs nominatifs repris dans les mails : ni adresse, ni lien, ni texte long (anti-relais de courrier).
 if(nameFields.includes(f.key) && (value.length>80 || /:\/\/|www\.|@/i.test(value)))return "Ce champ ne doit contenir que votre nom.";
 if(f.type==="choice" && !f.options.some(x=>x[0]===value))return "Sélectionnez une réponse proposée.";
 if(f.type==="birthdate" && ageFromDate(value,now)===null)return "Indiquez une date de naissance réelle, qui ne soit pas dans le futur.";
 if(f.type==="birthdate" && ageFromDate(value,now)>100)return "Vérifiez l’année de naissance.";
 if(f.type==="date" && !dateParts(value))return "Indiquez une date valide au format JJ/MM/AAAA.";
 if(f.type==="date" && f.documentDate && dateParts(value).time>dateParts(todayISO(now)).time)return "La date du document ne peut pas être dans le futur.";
 if(f.type==="month" && !monthParts(value))return "Indiquez un mois et une année valides.";
 if(f.type==="month" && value>todayISO(now).slice(0,7))return "Le mois du document ne peut pas être dans le futur.";
 if(f.type==="month" && f.maxMonths!=null && monthParts(value)){
  const d=monthParts(value),t=dateParts(todayISO(now));
  const months=(t.y-d.y)*12+t.m-d.m;
  if(months>f.maxMonths)return "Ce document doit dater de moins de "+f.maxMonths+" mois.";
 }
 if(f.type==="year" && !yearParts(value))return "Indiquez une année valide (AAAA).";
 if(f.type==="year" && yearParts(value)){
  const y=yearParts(value).y,t=dateParts(todayISO(now));
  if(y>t.y)return "L’année du document ne peut pas être dans le futur.";
  if(y<t.y-80)return "Vérifiez l’année du document.";
 }
 if(f.type==="email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return "Vérifiez l’adresse e-mail.";
 if(f.type==="tel" && (!/^\+?[\d\s().-]{6,30}$/.test(value) || value.replace(/\D/g, "").length<6))return "Vérifiez le numéro de téléphone.";
 return "";
}
export function cleanAnswers(input){
 // Nettoyer d'abord, choisir les étapes ensuite : stepsFor voit les mêmes valeurs qu'answerErrors (fonction idempotente).
 const trimmed={...Object.fromEntries(Object.entries(input).filter(([,v])=>typeof v==="string").map(([k,v])=>[k,v.trim()])),deferred:input.deferred};
 const out={workflow:typeof input.workflow==="string"?input.workflow:""};
 for(const s of stepsFor(trimmed))for(const f of s.fields)if(typeof trimmed[f.key]==="string")out[f.key]=trimmed[f.key];
 // Keep only the identity type corresponding to the declared nationality.
 if(!(identities[out.nationality]||[]).some(x=>x[0]===out.identityDocument)){delete out.identityDocument;delete out.identityExpiry;}
 // Pièces différées : clés de documents uniques ; leur validité est contrôlée par answerErrors.
 out.deferred=[...new Set(deferredKeys(input).map(k=>k.trim()).filter(Boolean))].slice(0,limits.fileCount);
 return out;
}
export function answerErrors(a,now=new Date()){
 const errors=[];
 if(!Object.prototype.hasOwnProperty.call(workflows,a.workflow))errors.push({step:"identity",field:"workflow",message:"Questionnaire inconnu."});
 for(const s of stepsFor(a))for(const f of s.fields){const msg=fieldError(f,a[f.key],now);if(msg)errors.push({step:s.id,field:f.key,message:f.label+" : "+msg});}
 const age=ageFromDate(a.birthDate,now);
 if(age!==null && age<15)errors.push({step:"identity",field:"birthDate",message:"Date de naissance : cette démarche concerne les candidats de 15 ans et plus. Contactez AEM."});
 if(a.deferred!==undefined && !Array.isArray(a.deferred))errors.push({step:"summary",field:"deferred",message:"Pièces différées : format invalide."});
 const docs=documentsFor(a,now);
 for(const key of deferredKeys(a)){
 const doc=docs.find(d=>d.key===key);
 if(!doc)errors.push({step:"summary",field:"deferred",message:"Pièces différées : document inconnu pour cette situation."});
 else if(!doc.deferrable)errors.push({step:"summary",field:"deferred",message:doc.label+" : cette pièce doit être jointe, elle ne peut pas être récupérée plus tard par AEM."});
 }
 return errors;
}
export function missingRequiredDocuments(a,files=[],now=new Date()){
 return documentsFor(a,now).filter(d=>d.requiredUpload && !files.some(f=>f.key===d.key) && !(d.deferrable && isDeferred(a,d.key)));
}
export function subjectFor(a){const prefix={ants:"Dossier ANTS",permis:"Dossier permis"}[a.workflow]||"Dossier";return prefix+" – "+(a.birthName||"").toUpperCase()+" "+(a.firstName||"");}
export function displayValue(f,value){if(!value)return "Non renseigné";if(f.type==="choice")return f.options.find(x=>x[0]===value)?.[1]||"À confirmer";if(f.type==="month")return formatMonth(value);if(f.type==="year")return formatYear(value);if(f.type==="date" || f.type==="birthdate")return formatDate(value);return value;}
export function auditText(a,files=[],now=new Date()){
 const age=ageFromDate(a.birthDate,now),validity=expiryStatus(a.identityExpiry,now),docs=documentsFor(a,now);
 const names=key=>files.filter(f=>f.key===key).map(f=>f.name);
 const deferred=deferredDocuments(a,files,now),deferredKeySet=new Set(deferred.map(d=>d.key)),deferredLine="  À FOURNIR : le candidat indique ne pas avoir ce document ; à récupérer par AEM";
 const documentLines=group=>docs.filter(d=>d.group===group).map(d=>d.label+" :\n"+(names(d.key).length?names(d.key).map(n=>"  - "+n+" — transmis, à vérifier").join("\n"):deferredKeySet.has(d.key)?deferredLine:"  Aucun fichier transmis")).join("\n");
 const homeTypeLabel={facture:"Facture d’abonnement",loyer:"Quittance de loyer",impot:"Dernier avis d’imposition"}[a.homeProof]||"Non renseigné";
 const homeDateLines=a.homeProof==="impot"
  ?["Année du document : "+formatYear(a.homeDate),yearAge(a.homeDate,now)]
  :["Mois et année du document : "+formatMonth(a.homeDate),monthAge(a.homeDate,now)];
 const text=[
 "AUDIT – "+(workflows[a.workflow]||"").toUpperCase(),
 "Informations déclarées par le candidat. Fichier transmis ≠ document conforme.",
 "\nIDENTITÉ","Nom : "+a.birthName.toUpperCase(),"Prénom : "+a.firstName,
 "Date de naissance : "+formatDate(a.birthDate)+(age===null?" — âge non calculé":" ("+age+" ans)"),
 "Nationalité : "+(a.nationality==="francaise"?"Française":"Étrangère"),
 "\nCOORDONNÉES","Téléphone candidat : "+a.phone,"E-mail candidat : "+a.email,
 "\nPIÈCE D’IDENTITÉ","Type : "+identityLabel(a),"Expiration : "+formatDate(a.identityExpiry),
 "Indicateur selon la date déclarée : "+validity.status,validity.detail,documentLines("identity")
 ];
 text.push("\nDOCUMENTS LIÉS À L’ÂGE",age===null?"Âge inconnu : pièces à déterminer par AEM.":documentLines("age")||"Aucune pièce prévue pour cette branche.");
 if(isMinor(a,now))text.push("\nPERSONNE À CONTACTER","Nom et prénom : "+(a.contactName||"Non renseigné"),"Téléphone : "+(a.contactPhone||"Non renseigné"),"E-mail : "+(a.contactEmail||"Non renseigné"));
 text.push("\nDOMICILE","Situation : "+(a.home==="parents"?"Hébergé chez ses parents":"Justificatif à son nom"),
 "Type : "+homeTypeLabel,...homeDateLines,documentLines("home"));
 if(a.home==="parents")text.push("Attestation d’hébergement : à joindre datée d’aujourd’hui (modèle fourni dans le mail).");
 const extras=stepsFor(a).filter(s=>["europeSituation","special","specialFiles","medical"].includes(s.id));
 if(extras.length)text.push("\nAUTRES INFORMATIONS");
 for(const s of extras)for(const f of s.fields)text.push(f.label+" : "+displayValue(f,a[f.key]));
 for(const group of ["special","permit","medical"])if(documentLines(group))text.push(documentLines(group));
 if(age===null)text.push("Âge non calculé : date de naissance absente ou invalide. Documents liés à l’âge et coordonnées du responsable à déterminer par AEM.");
 if(age!==null && age<15)text.push("Branche de moins de 15 ans : à confirmer avec l’administration.");
 if(a.workflow==="permis" && age!==null && age<18)text.push("Situation du mineur : à confirmer avec l’administration.");
 text.push("\nDOCUMENTS TRANSMIS");
 text.push(...docs.map(d=>d.label+"\n"+(names(d.key).map(n=>"  - "+n).join("\n")||(deferredKeySet.has(d.key)?deferredLine:"  Aucun fichier transmis"))));
 if(deferred.length)text.push("\nPIÈCES À RÉCUPÉRER PAR AEM","Le candidat indique ne pas avoir ces documents sous la main. AEM le recontacte pour les récupérer :",...deferred.map(d=>"  - "+d.label+" — À FOURNIR"));
 text.push("\nAEM vérifie les pièces et réalise la suite manuellement. Aucun dossier n’a été validé automatiquement.");
 return text.filter(x=>x!=="").join("\n");
}
