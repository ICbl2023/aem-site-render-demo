// Service autonome : questionnaires, transmission, audits et administration.
import {createApp} from "./server.js";
import {config} from "./server-config.js";
const demo=process.argv.includes("--demo");
const port=Number(process.env.PORT||(demo?3015:3014));
const origin=config.origin||"http://127.0.0.1:"+port;
const settings={...config,standalone:true,port,origin,...(demo?{
 dataDir:process.env.AEM_DATA_DIR||".data-questionnaires-demo",
 receiptDir:process.env.AEM_RECEIPT_DIR||".receipts-questionnaires-demo",
 adminAccounts:"demo:demo:responsable",adminPassword:"",adminPrefill:"demo:demo",candidateMail:false
}:{})};
const app=createApp({demo,config:settings});
app.on("error",error=>{console.error(error.message);process.exitCode=1;});
app.listen(port,settings.host,()=>{
 console.log("Questionnaires autonomes"+(demo?" — démonstration sans e-mail":"")+" :");
 console.log(origin+settings.basePath+"/ants.html");
 console.log(origin+settings.basePath+"/permis.html");
 console.log("Administration : "+origin+settings.basePath+"/admin.html"+(demo?" (demo / demo, prérempli)":""));
});
