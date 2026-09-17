import {mkdir,copyFile,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {questionnairePublicFiles,questionnaireServerFiles} from "../questionnaire-files.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const target=path.join(root,"questionnaires-autonomes");
await mkdir(target,{recursive:true});
for(const name of [...questionnairePublicFiles,...questionnaireServerFiles,"package-lock.json",".env.example"]){
 await mkdir(path.dirname(path.join(target,name)),{recursive:true});
 await copyFile(path.join(root,name),path.join(target,name));
}
// Contenu légal conservé, navigation propre au service autonome.
for(const name of ["confidentialite.html","mentions-legales.html"]){
 let html=await readFile(path.join(target,name),"utf8");
 html=html.replace(/<nav aria-label="Navigation principale">[\s\S]*?<\/nav>/,'<nav aria-label="Navigation principale"><ul class="site-menu"><li><a href="./ants.html">Questionnaire ANTS</a></li><li><a href="./permis.html">Questionnaire Permis</a></li></ul></nav>');
 html=html.replace(/<div><h3>Le site<\/h3>[\s\S]*?<\/ul><\/div>/,'<div><h3>Questionnaires</h3><ul><li><a href="./ants.html">ANTS</a></li><li><a href="./permis.html">Permis</a></li></ul></div>');
 html=html.replaceAll('./inscription.html','./ants.html').replaceAll('./apres-examen.html','./permis.html');
 html=html.replace(/<script[^>]*src="(?:chat|scene)\.js[^"]*"[^>]*><\/script>/g,"");
 await writeFile(path.join(target,name),html);
}
const pkg=JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
pkg.scripts={start:"node --env-file-if-exists=.env questionnaire-server.js",demo:"node --env-file-if-exists=.env questionnaire-server.js --demo","check:mail":"node --env-file-if-exists=.env scripts/check-mail.js"};
await writeFile(path.join(target,"package.json"),JSON.stringify(pkg,null,2)+"\n");
await copyFile(path.join(root,"QUESTIONNAIRES.md"),path.join(target,"README.md"));
await writeFile(path.join(target,".gitignore"),"node_modules/\n.env\n.data*/\n.runtime/\n.receipts*/\n");
await writeFile(path.join(target,"LANCER-TEST.cmd"),'@echo off\r\ncd /d "%~dp0"\r\nif not exist node_modules call npm.cmd ci --omit=dev --ignore-scripts\r\nif errorlevel 1 exit /b 1\r\ncall npm.cmd run demo\r\npause\r\n');
console.log("Paquet autonome prêt : "+target);
