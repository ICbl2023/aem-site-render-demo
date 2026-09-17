import {mkdir,copyFile,readFile,writeFile,cp,access} from "node:fs/promises";
const files=["portail.html","formations.html","tarifs.html","demarches.html","inscription.html","apres-examen.html","rendez-vous.html","contact.html","mentions-legales.html","confidentialite.html","ants.html","permis.html","admin.html","admin.css","admin.js","styles.css","app.js","logic.js","drafts.js","draft-remote.js","draft-ui.js","voice.js","icons.js","scene.js","chat.js","assist.js","assist-extract.js","guide.js","fonts/overpass-var.woff2","fonts/atkinson-var.woff2","cropped-logo_auto-ecole-meyzieu.png"];
const previewCss=`.preview-banner{padding:10px 16px;background:#fff4e8;border-bottom:1px solid #f0c899;color:#7a3b00;font-size:13px;font-weight:700;text-align:center;line-height:1.5}.preview-banner strong{color:#a94300}`;
const previewHtml='<div class="preview-banner" role="status"><strong>Prévisualisation Netlify</strong> — Parcours testable. L’envoi, l’administration et le stockage des pièces nécessitent le serveur Node (Render ou local).</div>';
const headers=`/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
`;
await mkdir("public/fonts",{recursive:true});
for(const file of files)await copyFile(file,"public/"+file);
for(const dir of ["photos","voice"]){try{await access(dir);await cp(dir,"public/"+dir,{recursive:true});}catch{/* dossier absent : rien à copier */}}
for(const page of ["portail.html","formations.html","tarifs.html","demarches.html","inscription.html","apres-examen.html","rendez-vous.html","contact.html","mentions-legales.html","confidentialite.html","ants.html","permis.html","admin.html"]){
 let html=await readFile("public/"+page,"utf8");
 if(!html.includes("preview-banner")){
  html=html.replace("</head>",`<style>${previewCss}</style>\n</head>`);
  html=html.replace("<body>","<body>\n"+previewHtml);
 }
 await writeFile("public/"+page,html);
}
await copyFile("public/portail.html","public/index.html");
await writeFile("public/_headers",headers);
await writeFile("public/robots.txt","User-agent: *\nDisallow: /\n");
await writeFile("public/_redirects","/ants /ants.html 200\n/permis /permis.html 200\n/admin /admin.html 200\n");
console.log("Prévisualisation Netlify prête dans public/. Déployez avec : npm run deploy:netlify");
