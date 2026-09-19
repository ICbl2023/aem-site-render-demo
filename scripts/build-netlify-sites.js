// Construit 3 dossiers prêts à glisser-déposer sur Netlify (ANTS / Permis / Admin).
// Noms volontairement reconnaissables pour publication manuelle.
import {mkdir,copyFile,readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const parent=path.resolve(root,"..");
const stamp="2026-09-18";
const sharedFonts=[
 "fonts/overpass-var.woff2","fonts/atkinson-var.woff2","cropped-logo_auto-ecole-meyzieu.png",
 "styles.css","mentions-legales.html","confidentialite.html"
];
const questionnaireShared=[
 ...sharedFonts,"app.js","logic.js","drafts.js","draft-remote.js","draft-boot.js","draft-ui.js","icons.js","scene.js"
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
const note=`PUBLICATION NETLIFY — INTERFACE UNIQUEMENT
========================================
Ce dossier est prêt à être publié avec TON compte Netlify
(glisser-déposer sur https://app.netlify.com/drop après connexion,
ou : npx netlify-cli login puis npx netlify-cli deploy --dir=. --prod).

C’est l’interface visuelle pour Luc / l’équipe.
L’envoi des dossiers, les brouillons multi-appareils, les photos
stockées et l’Admin réel nécessitent le serveur Node (Render).

Sans ce serveur derrière : parcours visible à l’écran, pas de
traitement complet.
`;

async function copyInto(target,files){
 for(const name of files){
  const dest=path.join(target,name);
  await mkdir(path.dirname(dest),{recursive:true});
  await copyFile(path.join(root,name),dest);
 }
}

async function build(folderName,label,files,sourceHtml,title,redirects=""){
 const target=path.join(parent,folderName);
 await rm(target,{recursive:true,force:true});
 await mkdir(target,{recursive:true});
 await copyInto(target,files);
 let html=await readFile(path.join(root,sourceHtml),"utf8");
 html=html.replace(/<title>[^<]*<\/title>/,"<title>"+title+"</title>");
 await writeFile(path.join(target,"index.html"),html);
 if(sourceHtml!=="index.html")await writeFile(path.join(target,sourceHtml),html);
 await writeFile(path.join(target,"_headers"),headers);
 await writeFile(path.join(target,"robots.txt"),"User-agent: *\nDisallow: /\n");
 await writeFile(path.join(target,"LIREMOI.txt"),label+"\n"+note);
 if(redirects)await writeFile(path.join(target,"_redirects"),redirects);
 console.log("OK "+target);
}

await build(
 "AEM-Netlify-ANTS-"+stamp,
 "AEM Majolane — Questionnaire ANTS ("+stamp+")",
 questionnaireShared,
 "ants.html",
 "AEM Majolane — Questionnaire ANTS",
 "/ /index.html 200\n/ants /index.html 200\n/ants.html /index.html 200\n"
);
await build(
 "AEM-Netlify-Permis-"+stamp,
 "AEM Majolane — Questionnaire Permis ("+stamp+")",
 questionnaireShared,
 "permis.html",
 "AEM Majolane — Questionnaire Permis",
 "/ /index.html 200\n/permis /index.html 200\n/permis.html /index.html 200\n"
);
await build(
 "AEM-Netlify-Admin-"+stamp,
 "AEM Majolane — Zone Admin ("+stamp+")",
 [...sharedFonts,"admin.html","admin.css","admin.js"],
 "admin.html",
 "AEM Majolane — Zone Admin",
 "/ /index.html 200\n/admin /index.html 200\n/admin.html /index.html 200\n"
);
console.log("Trois dossiers prêts à publier (connecté à Netlify) :");
console.log("  "+path.join(parent,"AEM-Netlify-ANTS-"+stamp));
console.log("  "+path.join(parent,"AEM-Netlify-Permis-"+stamp));
console.log("  "+path.join(parent,"AEM-Netlify-Admin-"+stamp));
