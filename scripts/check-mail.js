import {config} from "../server-config.js";
import {resolveEmailProvider,createEmailTransport,createMailTransport} from "../email-transport.js";

function fail(msg){console.error(msg);process.exitCode=1;}

try{
 const resolved=resolveEmailProvider(config);
 if(!resolved.mailEnabled){
  if(config.emailProvider==="resend"){
   fail("AEM_EMAIL_PROVIDER=resend mais la messagerie n’est pas active (vérifiez RESEND_API_KEY, AEM_FROM, AEM_RECIPIENT). Aucun email envoyé.");
  }else{
   fail("Messagerie inactive : renseignez AEM_FROM, AEM_RECIPIENT et soit SMTP_HOST (SMTP), soit AEM_EMAIL_PROVIDER=resend + RESEND_API_KEY. Aucun email envoyé.");
  }
 }else if(!config.origin){
  fail("AEM_ORIGIN ou RENDER_EXTERNAL_URL manquant. Aucun email envoyé.");
 }else if(resolved.provider==="resend"){
  const transport=createEmailTransport(config);
  try{
   await transport.verify();
   console.log("Configuration Resend présente (clé et adresses). Authentification API non prouvée ici (pas d’appel réseau). Aucun email envoyé. La réception réelle reste à tester après autorisation.");
   console.log("Rappel : le droit « envoi seul » suffit pour l’application ; une clé Full access n’est pas exigée pour check:mail.");
  }finally{transport?.close?.();}
 }else{
  const transport=createMailTransport(config);
  try{
   await transport.verify();
   console.log("Connexion SMTP et authentification vérifiées. Aucun email envoyé. La réception réelle reste à tester.");
  }catch(e){
   const reason={EAUTH:"Authentification refusée",ECONNECTION:"Connexion impossible",ETIMEDOUT:"Délai de connexion dépassé",ESOCKET:"Connexion TLS/SMTP interrompue"}[e.code]||"Échec de la vérification SMTP";
   fail(reason+". Vérifiez les paramètres privés et les autorisations du fournisseur. Aucun email envoyé.");
  }finally{transport.close();}
 }
}catch(e){
 fail((e.message||"Configuration mail invalide")+". Aucun email envoyé.");
}
