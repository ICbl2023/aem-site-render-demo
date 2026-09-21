import {DAY_MS,finalizedAtOf} from "./storage.js";

export function expiresAtFrom(meta,retentionDays){
 if(!retentionDays || retentionDays<1)return null;
 const start=finalizedAtOf(meta);
 if(start===null)return null;
 return new Date(start+retentionDays*DAY_MS).toISOString();
}

export function prepareRetentionWarningMail({meta,kind,expiresAt},config){
 const when=new Date(expiresAt);
 const dateFr=new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(when);
 const label=kind===7?"J-7":"J-3";
 const who=((meta.birthName||"")+" "+(meta.firstName||"")).trim()||"Candidat";
 const lines=[
  "Bonjour,","",
  "Alerte de conservation "+label+" - Auto-ecole Majolane.","",
  "Le dossier finalise suivant arrive a echeance de conservation (2 mois) :","",
  "- Candidat : "+who,
  "- Reference : "+meta.id,
  "- Parcours : "+(meta.workflow||""),
  "- Date d echeance : "+dateFr,"",
  kind===7
   ?"Action possible : consultez la fiche Admin avant la suppression automatique."
   :"Rappel : sans action, le dossier et ses documents seront effaces a la date d echeance.",
  "","Cordialement,","Systeme AEM"
 ];
 return {
  from:config.from,
  to:config.recipient,
  subject:"AEM - conservation "+label+" - dossier "+String(meta.id).slice(0,8),
  text:lines.join("\n"),
  disableFileAccess:true,
  disableUrlAccess:true
 };
}

export function prepareFreeMail(meta,{subject,message},config){
 return {
  from:config.from,
  to:{address:meta.email,name:meta.firstName||""},
  replyTo:config.recipient||undefined,
  subject,
  text:message+"\n\n--\nReference dossier : "+meta.id+"\nAuto-ecole Majolane",
  disableFileAccess:true,
  disableUrlAccess:true
 };
}

export function freeMailBody(body){
 if(typeof body!=="object" || !body || Array.isArray(body))throw Object.assign(new Error("Corps de requete invalide."),{status:400});
 const subject=typeof body.subject==="string"?body.subject.trim():"";
 const message=typeof body.message==="string"?body.message.trim():"";
 if(!subject || subject.length>180)throw Object.assign(new Error("Objet invalide (1 a 180 caracteres)."),{status:400});
 if(!message || message.length>4000)throw Object.assign(new Error("Message invalide (1 a 4000 caracteres)."),{status:400});
 if(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(subject+message))throw Object.assign(new Error("Caracteres de controle non acceptes."),{status:400});
 return {subject,message};
}

export async function runRetentionMaintenance({storage,config,sendWarning,now=Date.now()}){
 const days=Number(config.retentionDays)||0;
 if(days<1)return {warned7:0,warned3:0,removed:0,skipped:true};
 const items=await storage.list();
 let warned7=0,warned3=0;
 for(const item of items){
  const meta=await storage.get(item.id);
  if(!meta)continue;
  const expiresAt=expiresAtFrom(meta,days);
  if(!expiresAt)continue;
  const expires=new Date(expiresAt).getTime();
  if(!Number.isFinite(expires) || now>=expires)continue;
  const remaining=expires-now;
  if(sendWarning && !meta.warning7SentAt && remaining<=7*DAY_MS){
   try{
    await sendWarning(prepareRetentionWarningMail({meta,kind:7,expiresAt},config),meta);
    await storage.update(meta.id,{warning7SentAt:new Date(now).toISOString()},{by:"systeme",action:"retention_warning",details:"Alerte J-7 envoyee (echeance "+expiresAt+")"});
    warned7++;
   }catch(e){console.error("Alerte J-7 impossible",meta.id,e.message||e);}
  }
  const fresh=await storage.get(meta.id);
  if(sendWarning && fresh && !fresh.warning3SentAt && remaining<=3*DAY_MS){
   try{
    await sendWarning(prepareRetentionWarningMail({meta:fresh,kind:3,expiresAt},config),fresh);
    await storage.update(fresh.id,{warning3SentAt:new Date(now).toISOString()},{by:"systeme",action:"retention_warning",details:"Alerte J-3 envoyee (echeance "+expiresAt+")"});
    warned3++;
   }catch(e){console.error("Alerte J-3 impossible",fresh.id,e.message||e);}
  }
 }
 const removed=await storage.purgeOlderThan(days,Math.min(days,90),now);
 return {warned7,warned3,removed,skipped:false};
}
