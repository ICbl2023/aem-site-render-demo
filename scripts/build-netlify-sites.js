// Construit 3 dossiers prêts pour un dépôt Netlify séparé (ANTS / Permis / Admin).
import {mkdir,copyFile,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const parent=path.resolve(root,"..");
const sharedFonts=[
 "fonts/overpass-var.woff2","fonts/atkinson-var.woff2","cropped-logo_auto-ecole-meyzieu.png",
 "styles.css","mentions-legales.html","confidentialite.html"
];
const questionnaireShared=[
 ...sharedFonts,"app.js","logic.js","drafts.js","draft-remote.js","draft-ui.js","icons.js","scene.js"
];
const headers=`/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
`;
const note=`Netlify — aperçu front uniquement
================================
Ce dossier contient l’interface. L’envoi des dossiers, le stockage des pièces
et l’administration complète nécessitent le serveur Node (Render / VPS).

Déploiement : glisser-déposer ce dossier sur https://app.netlify.com/drop
ou : npx netlify-cli deploy --dir=.
`;

async function copyInto(target,files){
 for(const name of files){
  const dest=path.join(target,name);
  await mkdir(path.dirname(dest),{recursive:true});
  await copyFile(path.join(root,name),dest);
 }
}

async function build(name,files,sourceHtml,redirects=""){
 const target=path.join(parent,"netlify-"+name);
 await rm(target,{recursive:true,force:true});
 await mkdir(target,{recursive:true});
 await copyInto(target,files);
 let html=await readFile(path.join(root,sourceHtml),"utf8");
 await writeFile(path.join(target,"index.html"),html);
 if(sourceHtml!=="index.html")await copyFile(path.join(root,sourceHtml),path.join(target,sourceHtml));
 await writeFile(path.join(target,"_headers"),headers);
 await writeFile(path.join(target,"robots.txt"),"User-agent: *\nDisallow: /\n");
 await writeFile(path.join(target,"LIREMOI.txt"),"Site "+name.toUpperCase()+" — "+note);
 if(redirects)await writeFile(path.join(target,"_redirects"),redirects);
 console.log("OK "+target);
}

await build("ants",questionnaireShared,"ants.html","/ /index.html 200\n/ants /index.html 200\n/ants.html /index.html 200\n");
await build("permis",questionnaireShared,"permis.html","/ /index.html 200\n/permis /index.html 200\n/permis.html /index.html 200\n");
await build("admin",[...sharedFonts,"admin.html","admin.css","admin.js"],"admin.html","/ /index.html 200\n/admin /index.html 200\n/admin.html /index.html 200\n");
console.log("Trois dossiers prêts sous Documents/site-AEM/netlify-ants|permis|admin");
