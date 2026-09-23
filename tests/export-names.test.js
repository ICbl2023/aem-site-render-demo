import test from "node:test";
import assert from "node:assert/strict";
import {
 exportFileName,exportCodeFor,personFolderName,zipArchiveFileName,
 exportNamesForDossier,needsFaceQualification,sanitizeWindowsBase
} from "../export-names.js";
import {adminDocumentLabel} from "../logic.js";

test("personFolderName conserve accents et forme NOM Prénom",()=>{
 assert.equal(personFolderName("Récammier","zoé"),"RÉCAMMIER Zoé");
 assert.equal(zipArchiveFileName("Récammier","Zoé"),"RÉCAMMIER Zoé.zip");
});

test("CI1 CI2 CI0 selon face explicite uniquement",()=>{
 assert.equal(exportCodeFor("identity_cni_fr",{face:"recto"}),"CI1");
 assert.equal(exportCodeFor("identity_cni_fr",{face:"verso"}),"CI2");
 assert.equal(exportCodeFor("identity_cni_fr",{face:"both"}),"CI0");
 assert.equal(exportCodeFor("identity_cni_fr",{face:""}),"identite");
 assert.equal(exportCodeFor("parent_identity",{face:"recto"}),"CI HEB1");
 assert.equal(exportCodeFor("parent_identity",{face:""}),"CI HEB non qualifie");
 assert.ok(needsFaceQualification("identity_cni_fr"));
 assert.equal(needsFaceQualification("jdc"),false);
});

test("codes métier domicile attestation permis",()=>{
 assert.equal(exportCodeFor("home_own"),"facture");
 assert.equal(exportCodeFor("hosting"),"ATTEST HEB");
 assert.equal(exportCodeFor("jdc"),"JDC");
 assert.equal(exportCodeFor("assr_2"),"ASSR2");
 assert.equal(exportCodeFor("recensement"),"RECENS");
 assert.equal(exportCodeFor("permit_cepc"),"CEPC");
 assert.equal(exportCodeFor("permit_current"),"PERMIS");
 assert.equal(exportCodeFor("medical"),"MEDICAL");
 assert.equal(exportCodeFor("identity_passeport_fr"),"PASSEPORT");
 assert.equal(exportCodeFor("identity_sejour"),"TITRE SEJ");
 assert.equal(exportCodeFor("europe_residence",{europeSituation:"student"}),"SCOLARITE");
 assert.equal(exportCodeFor("europe_residence",{europeSituation:"worker"}),"facture EU");
});

test("exportFileName : accents, collisions, caractères Windows",()=>{
 const taken=new Set();
 const a=exportFileName({birthName:"Récammier",firstName:"Zoé",key:"identity_cni_fr",face:"recto",ext:"pdf",taken});
 assert.equal(a,"RÉCAMMIER Zoé CI1.pdf");
 const b=exportFileName({birthName:"Récammier",firstName:"Zoé",key:"identity_cni_fr",face:"recto",ext:"pdf",taken});
 assert.equal(b,"RÉCAMMIER Zoé CI1 (2).pdf");
 const bad=exportFileName({birthName:"A:B*C?",firstName:"Jean",key:"jdc",ext:"png",taken:new Set()});
 assert.ok(!/[\\/:*?"<>|]/.test(bad));
 assert.ok(bad.endsWith(".png"));
 assert.equal(sanitizeWindowsBase("CON"),"_CON");
});

test("exportNamesForDossier n’invente pas CI1 pour pièce non qualifiée",()=>{
 const names=exportNamesForDossier({
  birthName:"Dupont",firstName:"Alice",
  files:[
   {index:0,key:"identity_cni_fr",face:"",originalName:"id.pdf"},
   {index:1,key:"home_own",originalName:"bill.jpg"}
  ]
 });
 assert.match(names[0].exportName,/identite\.pdf$/i);
 assert.ok(!/CI[012]/.test(names[0].exportName));
 assert.match(names[1].exportName,/facture\.jpg$/i);
});

test("adminDocumentLabel : fiche de paie Europe → justificatif distinct de home_*",()=>{
 const eu={key:"europe_residence",label:"Fiche de paie de plus de six mois"};
 assert.equal(adminDocumentLabel(eu,{europeSituation:"worker"}),"Justificatif de domicile (situation Europe — activité professionnelle)");
 assert.equal(adminDocumentLabel(eu,{europeSituation:"student"}),"Fiche de paie de plus de six mois");
 const home={key:"home_own",label:"Justificatif de domicile à votre nom (moins de 6 mois)"};
 assert.equal(adminDocumentLabel(home,{}),"Justificatif de domicile à votre nom (moins de 6 mois)");
});
