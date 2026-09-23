// Transport mail serveur : SMTP (Nodemailer) ou Resend (HTTPS). Aucun secret dans le navigateur.
import nodemailer from "nodemailer";

export const RESEND_API_URL="https://api.resend.com/emails";
export const RESEND_IDEMPOTENCY_HOURS=24;
/** Limite Resend : 40 Mo apres encodage Base64 des pieces jointes. */
export const RESEND_MAX_ENCODED_ATTACHMENT_BYTES=40*1024*1024;

export function formatEmailAddress(value){
 if(value==null || value==="")return "";
 if(typeof value==="string")return value.trim();
 if(typeof value==="object"){
  const address=String(value.address||value.email||"").trim();
  if(!address)return "";
  const name=String(value.name||"").trim();
  if(!name)return address;
  const safe=name.replace(/[\r\n<>]/g," ").trim();
  return safe?safe+" <"+address+">":address;
 }
 return String(value).trim();
}

export function addressList(value){
 if(value==null || value==="")return [];
 if(Array.isArray(value))return value.map(formatEmailAddress).filter(Boolean);
 const one=formatEmailAddress(value);
 return one?[one]:[];
}

export function extractAddress(value){
 const formatted=formatEmailAddress(value);
 const m=formatted.match(/<([^>]+)>/);
 return (m?m[1]:formatted).trim().toLowerCase();
}

export function resolveEmailProvider(config={}){
 const raw=String(config.emailProvider??"").trim().toLowerCase();
 if(raw==="disabled")return {provider:"disabled",mailEnabled:false};
 if(raw==="resend"){
  const missing=[];
  if(!config.resendApiKey)missing.push("RESEND_API_KEY");
  if(!config.from)missing.push("AEM_FROM");
  if(!config.recipient)missing.push("AEM_RECIPIENT");
  if(missing.length){
   const err=new Error("Configuration Resend incomplete : "+missing.join(", ")+".");
   err.code="EMAIL_CONFIG";err.status=503;throw err;
  }
  return {provider:"resend",mailEnabled:true};
 }
 if(raw==="smtp"){
  const missing=[];
  if(!config.smtpHost)missing.push("SMTP_HOST");
  if(!config.from)missing.push("AEM_FROM");
  if(!config.recipient)missing.push("AEM_RECIPIENT");
  if(missing.length){
   const err=new Error("Configuration SMTP incomplete : "+missing.join(", ")+".");
   err.code="EMAIL_CONFIG";err.status=503;throw err;
  }
  return {provider:"smtp",mailEnabled:true};
 }
 if(raw==="" || raw==="auto"){
  const mailEnabled=Boolean(config.smtpHost && config.from && config.recipient);
  return {provider:mailEnabled?"smtp":"disabled",mailEnabled};
 }
 const err=new Error("AEM_EMAIL_PROVIDER invalide (valeurs : smtp, resend, disabled, ou vide pour le comportement SMTP historique).");
 err.code="EMAIL_CONFIG";err.status=503;throw err;
}

export function mailError(message,{status=502,code="",uncertain=false,retryAfter=null,provider=""}={}){
 const err=new Error(message);
 err.status=status;err.code=code;err.uncertain=Boolean(uncertain);err.retryAfter=retryAfter;err.provider=provider;
 return err;
}

/** Qualification partagee envoi initial / retry Admin. */
export function qualifyMailError(error){
 if(!error)return {state:"failed",message:"erreur inconnue"};
 if(error.uncertain===true)return {state:"uncertain",message:error.message||"resultat incertain"};
 const code=String(error.code||"");
 if(/^(ETIMEDOUT|ESOCKET|ECONNECTION|ECONNRESET|EENVELOPE|ABORT_ERR|UND_ERR_CONNECT_TIMEOUT)$/i.test(code)){
  return {state:"uncertain",message:error.message||code};
 }
 const status=Number(error.status)||0;
 if(status===409 && /concurrent/i.test(code+error.message))return {state:"uncertain",message:error.message||"requete concurrente"};
 if([401,403,422,400].includes(status))return {state:"failed",message:error.message||("refus HTTP "+status)};
 if(status===429)return {state:"failed",message:error.message||"quota ou limite de debit atteinte"};
 if(status===409)return {state:"failed",message:error.message||"conflit d'idempotence"};
 if(status>=500 && status<600)return {state:"uncertain",message:error.message||("erreur fournisseur "+status)};
 if(status>=400)return {state:"failed",message:error.message||("erreur HTTP "+status)};
 return {state:"failed",message:error.message||"echec d'envoi"};
}

function idempotencyKeyOf(mail){
 const headers=mail?.headers||{};
 return String(mail?.idempotencyKey||headers["Idempotency-Key"]||headers["idempotency-key"]||"").trim();
}

async function mapAttachments(attachments){
 if(!attachments?.length)return [];
 const out=[];let encodedTotal=0;
 for(const item of attachments){
  if(item.path || item.href || item.raw){
   throw mailError("Piece jointe refusee : chemins et URL externes interdits.",{status:422,code:"invalid_attachment"});
  }
  const filename=String(item.filename||item.name||"piece").slice(0,200);
  const contentType=String(item.contentType||item.type||"application/octet-stream");
  let buf;
  if(Buffer.isBuffer(item.content))buf=item.content;
  else if(typeof item.content==="string")buf=Buffer.from(item.content,"utf8");
  else if(item.content instanceof Uint8Array)buf=Buffer.from(item.content);
  else throw mailError("Piece jointe « "+filename+" » : contenu non supporte.",{status:422,code:"invalid_attachment"});
  const content=buf.toString("base64");
  encodedTotal+=Buffer.byteLength(content,"utf8");
  if(encodedTotal>RESEND_MAX_ENCODED_ATTACHMENT_BYTES){
   throw mailError("Pieces jointes trop volumineuses apres encodage (limite Resend 40 Mo).",{status:413,code:"attachment_too_large"});
  }
  out.push({filename,content,content_type:contentType});
 }
 return out;
}

export function createResendTransport(config={},options={}){
 const apiKey=config.resendApiKey||"";
 const timeoutMs=Number(config.emailTimeoutMs||options.timeoutMs||15000);
 const endpoint=options.endpoint||config.resendEndpoint||RESEND_API_URL;
 const fetchImpl=options.fetch||globalThis.fetch;
 if(typeof fetchImpl!=="function")throw mailError("fetch indisponible pour Resend.",{status:503,code:"EMAIL_CONFIG"});
 return {
  provider:"resend",
  async sendMail(mail){
   const to=addressList(mail.to);
   const from=formatEmailAddress(mail.from);
   if(!from || !to.length)throw mailError("Expediteur ou destinataire manquant.",{status:422,code:"validation_error",provider:"resend"});
   const reply=addressList(mail.replyTo||mail.reply_to);
   const body={
    from,
    to,
    subject:String(mail.subject||""),
    text:mail.text==null?undefined:String(mail.text)
   };
   if(mail.html!=null && mail.html!=="")body.html=String(mail.html);
   if(reply.length)body.reply_to=reply.length===1?reply[0]:reply;
   if(mail.attachments?.length)body.attachments=await mapAttachments(mail.attachments);
   const headers={Authorization:"Bearer "+apiKey,"Content-Type":"application/json"};
   const key=idempotencyKeyOf(mail);
   if(key){
    if(key.length<1 || key.length>256)throw mailError("Cle d'idempotence invalide (1-256 caracteres).",{status:400,code:"invalid_idempotency_key",provider:"resend"});
    headers["Idempotency-Key"]=key;
   }
   let response;
   try{
    response=await fetchImpl(endpoint,{
     method:"POST",
     headers,
     body:JSON.stringify(body),
     signal:AbortSignal.timeout(timeoutMs)
    });
   }catch(e){
    const aborted=e?.name==="AbortError" || e?.name==="TimeoutError" || /aborted|timeout/i.test(String(e?.message||""));
    throw mailError(aborted?"Delai d'attente Resend depasse.":(e.message||"Connexion Resend interrompue."),{
     status:502,code:aborted?"ETIMEDOUT":(e.code||"ECONNECTION"),uncertain:true,provider:"resend"
    });
   }
   const retryAfter=response.headers?.get?.("retry-after")||null;
   let payload=null;
   const raw=await response.text().catch(()=>"");
   if(raw){
    try{payload=JSON.parse(raw);}catch{
     if(response.ok)throw mailError("Reponse Resend illisible.",{status:502,code:"invalid_response",uncertain:true,provider:"resend"});
    }
   }
   if(!response.ok){
    const apiMsg=payload?.message||payload?.error?.message||payload?.name||("HTTP "+response.status);
    const apiName=payload?.name||payload?.error?.name||"";
    const uncertain=response.status>=500 || response.status===408 || (response.status===409 && /concurrent/i.test(apiName+apiMsg));
    throw mailError(String(apiMsg),{
     status:response.status,
     code:apiName||("HTTP_"+response.status),
     uncertain,
     retryAfter,
     provider:"resend"
    });
   }
   const id=payload?.id;
   if(!id || typeof id!=="string"){
    throw mailError("Reponse Resend sans identifiant exploitable.",{status:502,code:"invalid_response",uncertain:true,provider:"resend"});
   }
   return {
    accepted:to.map(extractAddress).filter(Boolean),
    messageId:id,
    provider:"resend",
    id,
    response:payload
   };
  },
  async verify(){
   if(!apiKey)throw mailError("RESEND_API_KEY manquante.",{status:503,code:"EMAIL_CONFIG",provider:"resend"});
   return true;
  },
  close(){}
 };
}

export function createSmtpTransport(config={}){
 const transport=nodemailer.createTransport({
  host:config.smtpHost,port:config.smtpPort,secure:config.smtpPort===465,requireTLS:config.smtpPort!==465,
  ...(config.smtpUser?{auth:{user:config.smtpUser,pass:config.smtpPass}}:{}),
  connectionTimeout:Number(config.emailTimeoutMs||15000),
  greetingTimeout:Number(config.emailTimeoutMs||15000),
  socketTimeout:Math.max(45000,Number(config.emailTimeoutMs||15000)),
  disableFileAccess:true,disableUrlAccess:true
 });
 const sendMail=transport.sendMail.bind(transport);
 transport.provider="smtp";
 transport.sendMail=async function wrapped(mail){
  const result=await sendMail(mail);
  return {...result,provider:"smtp"};
 };
 return transport;
}

/** Alias historique (Nodemailer pur). */
export function createMailTransport(config){
 return createSmtpTransport(config);
}

/**
 * Fabrique le transport selon AEM_EMAIL_PROVIDER.
 * options.endpoint / options.fetch : tests locaux uniquement (jamais depuis le navigateur).
 */
export function createEmailTransport(config={},options={}){
 const {provider,mailEnabled}=resolveEmailProvider(config);
 if(!mailEnabled || provider==="disabled")return null;
 if(provider==="resend")return createResendTransport(config,options);
 return createSmtpTransport(config);
}
