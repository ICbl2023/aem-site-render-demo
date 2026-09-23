// Nomenclature d’export Admin (téléchargement, drag sortant, dossier local, ZIP).
// Ne renomme pas les blobs serveur ; originalName / storedAs / index restent la source physique.

export const FACE_VALUES = Object.freeze(["", "recto", "verso", "both"]);
export const FACE_LABELS = Object.freeze({
 "": "À qualifier",
 recto: "Recto",
 verso: "Verso",
 both: "Recto et verso"
});

const RESERVED = new Set(["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"]);

/** Clés d’identité candidat / hébergeant qui exigent une face pour CI1/CI2/CI0. */
export function needsFaceQualification(key){
 const k=String(key||"");
 return k.startsWith("identity_cni") || k==="parent_identity";
}

/** Code métier stable par clé technique (hors face). */
export function exportCodeBase(key){
 const k=String(key||"");
 if(k.startsWith("identity_cni"))return "CI";
 if(k==="parent_identity")return "CI HEB";
 if(k.includes("passeport"))return "PASSEPORT";
 if(k==="identity_sejour" || k.endsWith("_sejour") || k.includes("sejour"))return "TITRE SEJ";
 if(k.startsWith("home_"))return "facture";
 if(k==="hosting")return "ATTEST HEB";
 if(k==="jdc")return "JDC";
 if(k==="assr_2")return "ASSR2";
 if(k==="assr_15")return "ASSR";
 if(k==="recensement")return "RECENS";
 if(k==="permit_current")return "PERMIS";
 if(k==="permit_cepc")return "CEPC";
 if(k==="medical" || k==="special_medical")return "MEDICAL";
 if(k==="europe_residence")return "SCOLARITE"; // étudiant Europe ; override worker via options
 if(k.startsWith("special_"))return "JUSTIF";
 if(k.startsWith("identity_"))return "IDENTITE";
 return "DOC";
}

export function exportCodeFor(key,{face="",europeSituation=""}={}){
 const k=String(key||"");
 if(k==="europe_residence" && europeSituation==="worker")return "facture EU";
 if(needsFaceQualification(k)){
  const base=exportCodeBase(k);
  if(face==="recto")return base==="CI HEB"?"CI HEB1":"CI1";
  if(face==="verso")return base==="CI HEB"?"CI HEB2":"CI2";
  if(face==="both")return base==="CI HEB"?"CI HEB0":"CI0";
  // Non qualifié : pas de CI1/CI2/CI0 inventé.
  return base==="CI HEB"?"CI HEB non qualifie":"identite";
 }
 return exportCodeBase(k);
}

export function normalizeFace(value){
 const v=String(value||"").trim().toLowerCase();
 if(v==="recto" || v==="verso" || v==="both")return v;
 return "";
}

export function personFolderName(birthName,firstName){
 const nom=sanitizeWindowsBase(String(birthName||"").toUpperCase())||"CANDIDAT";
 const raw=String(firstName||"").trim();
 const prenom=sanitizeWindowsBase(raw?raw.charAt(0).toUpperCase()+raw.slice(1):"")||"Prenom";
 return uniqueWindowsName(nom+" "+prenom,{max:120});
}

export function fileExtension(name){
 const m=String(name||"").match(/\.([A-Za-z0-9]{1,8})$/);
 return m?m[1].toLowerCase():"bin";
}

/** Nettoyage Windows (pas de traversée, pas de réservés, pas de point/espace final). */
export function sanitizeWindowsBase(value,{max=160}={}){
 let s=String(value||"")
  .replace(/[\\/:*?"<>|\u0000-\u001f]/g," ")
  .replace(/\s+/g," ")
  .trim();
 s=s.replace(/[. ]+$/g,"").trim();
 if(!s)s="document";
 const stem=s.split(".")[0].toUpperCase();
 if(RESERVED.has(stem))s="_"+s;
 return s.slice(0,max)||"document";
}

export function uniqueWindowsName(baseName,{taken=new Set(),max=180}={}){
 const raw=String(baseName||"document");
 const extMatch=raw.match(/\.([A-Za-z0-9]{1,8})$/);
 const ext=extMatch?extMatch[1].toLowerCase():"";
 let stem=sanitizeWindowsBase(ext?raw.slice(0,-(ext.length+1)):raw,{max:Math.max(40,max-(ext?ext.length+1:0))});
 let candidate=ext?stem+"."+ext:stem;
 let n=1;
 while(taken.has(candidate.toLowerCase())){
  n++;
  const suffix=" ("+n+")";
  const room=Math.max(20,max-(ext?ext.length+1:0)-suffix.length);
  const cut=sanitizeWindowsBase(stem.slice(0,room),{max:room});
  candidate=ext?cut+suffix+"."+ext:cut+suffix;
 }
 taken.add(candidate.toLowerCase());
 return candidate;
}

/**
 * Nom d’export unifié.
 * @param {object} opts
 * @param {string} opts.birthName
 * @param {string} opts.firstName
 * @param {string} opts.key
 * @param {string} [opts.face]
 * @param {string} [opts.ext]
 * @param {string} [opts.europeSituation]
 * @param {Set<string>} [opts.taken] — noms déjà pris (insensible à la casse)
 */
export function exportFileName({birthName,firstName,key,face="",ext="bin",europeSituation="",taken=new Set()}={}){
 const person=personFolderName(birthName,firstName);
 const code=exportCodeFor(key,{face:normalizeFace(face),europeSituation});
 const extension=String(ext||"bin").replace(/[^A-Za-z0-9]/g,"").slice(0,8).toLowerCase()||"bin";
 const base=sanitizeWindowsBase(person+" "+code,{max:160});
 return uniqueWindowsName(base+"."+extension,{taken,max:180});
}

/** Tous les noms d’export d’un dossier (ordre des fichiers meta), sans collision. */
export function exportNamesForDossier(meta){
 const taken=new Set();
 const europeSituation=meta?.answers?.europeSituation||"";
 const files=Array.isArray(meta?.files)?meta.files:[];
 return files.map(file=>{
  const ext=fileExtension(file.originalName||file.name||file.displayName||"");
  const exportName=exportFileName({
   birthName:meta.birthName,
   firstName:meta.firstName,
   key:file.key,
   face:file.face,
   ext,
   europeSituation,
   taken
  });
  return {file,exportName,needsFace:needsFaceQualification(file.key),face:normalizeFace(file.face)};
 });
}

export function zipArchiveFileName(birthName,firstName){
 return personFolderName(birthName,firstName)+".zip";
}
