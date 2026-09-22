import {config} from "../server-config.js";
import {createMailTransport} from "../server.js";
const required=[["SMTP_HOST",config.smtpHost],["AEM_FROM",config.from],["AEM_RECIPIENT",config.recipient],["AEM_ORIGIN ou RENDER_EXTERNAL_URL",config.origin]];
if(config.smtpUser)required.push(["SMTP_PASS",config.smtpPass]);
const missing=required.filter(([,value])=>!value).map(([name])=>name);
if(missing.length){
 console.error("Configuration manquante : "+missing.join(", ")+". Aucun email envoyé.");
 process.exitCode=1;
}else{
 const transport=createMailTransport(config);
 try{
 await transport.verify();
 console.log("Connexion SMTP et authentification vérifiées. Aucun email envoyé. La réception réelle reste à tester.");
 }catch(e){
 const reason={EAUTH:"Authentification refusée",ECONNECTION:"Connexion impossible",ETIMEDOUT:"Délai de connexion dépassé",ESOCKET:"Connexion TLS/SMTP interrompue"}[e.code]||"Échec de la vérification SMTP";
 console.error(reason+". Vérifiez les paramètres privés et les autorisations du fournisseur. Aucun email envoyé.");
 process.exitCode=1;
 }finally{transport.close();}
}
