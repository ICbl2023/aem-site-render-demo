import {spawnSync} from "node:child_process";
import {readFileSync,existsSync} from "node:fs";
spawnSync("node",["scripts/build-public.js"],{stdio:"inherit"});
const args=["netlify","deploy","--dir=public","--message=AEM preview questionnaires"];
console.log("\nDéploiement Netlify (aperçu)…");
const result=spawnSync("npx",["--yes","netlify-cli",...args],{stdio:"inherit",encoding:"utf8"});
if(result.status!==0){
 console.error("\nDéploiement automatique impossible sans connexion Netlify.");
 console.error("Étapes manuelles :");
 console.error("  1. npm run build:preview");
 console.error("  2. npx netlify-cli login");
 console.error("  3. npx netlify-cli deploy --dir=public");
 console.error("Le dossier public/ est prêt pour un glisser-déposer sur https://app.netlify.com/drop");
 process.exit(result.status||1);
}
