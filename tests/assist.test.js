import test from "node:test";
import assert from "node:assert/strict";
import {localExtract,matchOption,findDates,findMonth,isoDate,capitalize,SKIP,SKIP_FILES,DONE,FILLER,YES_NO_HINT,isYesNo} from "../assist-extract.js";
import {guideReply} from "../guide.js";
import {parseReply,normalizeMessages} from "../chat-server.js";
import {stepsFor} from "../logic.js";
import {candidate} from "./helpers.js";

// Catalogue tel que window.aemForm.catalog() le fournit à assist.js (parcours ANTS d'un mineur hébergé chez ses parents).
const catalog=a=>stepsFor(a).filter(s=>s.id!=="summary").map(s=>({id:s.id,fields:s.fields.map(f=>({key:f.key,label:f.label,type:f.type,required:f.required!==false,step:s.title,options:f.type==="choice"?f.options.map(o=>[o[0],o[1]]):[]}))}));
const steps=catalog({...candidate,birthDate:"2010-03-12",home:"parents",special:"oui",specialReason:"other"});
const fields=steps.flatMap(s=>s.fields);
const keys=id=>steps.find(s=>s.id===id).fields.map(f=>f.key);
const extract=(text,step,expected=[])=>localExtract(text,fields,step?keys(step):[],expected);
const apos=s=>s.replace(/’/g,"'");

test("Extraction : noms et prénoms (« né le », nom de naissance, prénom seul)",()=>{
 assert.deepEqual(extract("je m’appelle Nolan Grayson né le 12/03/2004","identity"),{birthDate:"2004-03-12",firstName:"Nolan",birthName:"GRAYSON"});
 for(const t of ["Mon nom de naissance est Durand","Mon nom est Durand","nom Durand","Nom : Durand","c’est Durand."])assert.equal(extract(t,"identity",["birthName"]).birthName,"DURAND",t);
 assert.deepEqual(extract("Mon nom de naissance : Durand, prénom Léa","identity"),{birthName:"DURAND",firstName:"Léa"});
 assert.deepEqual(extract("Mon prénom est Léa","identity",["birthName"]),{firstName:"Léa"});
 assert.equal(extract("Durand, mon nom de naissance","identity",["birthName"]).birthName,undefined);
 assert.deepEqual(extract("Paul Durand né le 12/03/2004","coordinates",["phone"]),{birthDate:"2004-03-12"});
 assert.deepEqual(extract("je suis né le 12/03/2004","coordinates",["phone"]),{birthDate:"2004-03-12"});
 assert.deepEqual(extract("je suis née le 12 mars 2004","coordinates",["phone"]),{birthDate:"2004-03-12"});
});
test("Extraction : réponse courte à une question de nom, mots vides ignorés",()=>{
 for(const t of ["non","oui","euh","ben","ok","d’accord","pardon"])assert.deepEqual(extract(t,"identity",["birthName"]),{},t);
 assert.deepEqual(extract("Durand","identity",["birthName"]),{birthName:"DURAND"});
 assert.deepEqual(extract("Léa","identity",["firstName"]),{firstName:"Léa"});
 assert.deepEqual(extract("jean-pierre","identity",["firstName"]),{firstName:"Jean-Pierre"});
 assert.deepEqual(extract("mon père, Jean Dupont","contact",["contactName"]),{contactName:"Jean Dupont"});
 assert.deepEqual(extract("ma mère c’est Marie Dupont","contact",["contactName"]),{contactName:"Marie Dupont"});
 assert.equal(capitalize("jean-pierre d'aubigné"),"Jean-Pierre D'Aubigné");
});
test("Extraction : dates en chiffres, en lettres, dictées avec des espaces ; routage par question",()=>{
 assert.deepEqual(extract("2 mai 2004","identity",["birthDate"]),{birthDate:"2004-05-02"});
 assert.deepEqual(extract("le 12 mars 2004","identity",["birthDate"]),{birthDate:"2004-03-12"});
 assert.deepEqual(extract("12/3/04","identity",["birthDate"]),{birthDate:"2004-03-12"});
 assert.deepEqual(extract("12 03 2004","identity",["birthDate"]),{birthDate:"2004-03-12"});
 assert.deepEqual(extract("12 03 2004","coordinates",["phone"]),{},"espaces : seulement quand une date est attendue");
 assert.deepEqual(extract("12/03/2030","identityFiles",["identityExpiry"]),{identityExpiry:"2030-03-12"});
 assert.deepEqual(extract("le 5 août 2026","homeFiles",["homeDate"]),{homeDate:"2026-08"});
 assert.deepEqual(extract("12/03/2030","identityFiles",["identityExpiry"]),{identityExpiry:"2030-03-12"});
 assert.deepEqual(extract("août 2026","homeFiles",["homeDate"]),{homeDate:"2026-08"});
 assert.deepEqual(findDates("le 32/01/2004 puis 12.03.2004").map(d=>d.iso),["2004-03-12"],"bornes seulement : le calendrier est contrôlé par fieldError à l'application");
 assert.equal(findMonth("facture de février 2026"),"2026-02");assert.equal(findMonth("08/2026"),"2026-08");assert.equal(findMonth("rien"),"");
 assert.equal(isoDate(5,3,4),"2004-03-05");assert.equal(isoDate(5,3,85),"1985-03-05");assert.equal(isoDate(32,1,2004),"");
});
test("Extraction : téléphones du candidat et du responsable",()=>{
 assert.deepEqual(extract("06 12 34 56 78","coordinates",["phone"]),{phone:"0612345678"});
 assert.deepEqual(extract("+33 6 12 34 56 78","coordinates",["phone"]),{phone:"0612345678"});
 assert.deepEqual(extract("06.12.34.56.78","coordinates",["phone"]),{phone:"0612345678"});
 assert.deepEqual(extract("07 11 22 33 44","contact",["contactPhone"]),{contactPhone:"0711223344"});
 assert.deepEqual(extract("moi 06 12 34 56 78 et mon père 07 11 22 33 44","coordinates",["phone"]),{phone:"0612345678",contactPhone:"0711223344"});
});
test("Extraction : e-mails écrits ou épelés, accents retirés, e-mail du responsable séparé",()=>{
 for(const t of ["c’est jean arobase gmail point com","mon adresse est jean arobase gmail point com","alors jean arobase gmail point com"])assert.deepEqual(extract(t,"coordinates",["email"]),{email:"jean@gmail.com"},t);
 assert.deepEqual(extract("jean point dupont arobase gmail point com","coordinates",["email"]),{email:"jean.dupont@gmail.com"});
 assert.deepEqual(extract("mon mail c’est jean tiret paul arobase orange point fr merci","coordinates",["email"]),{email:"jean-paul@orange.fr"});
 assert.deepEqual(extract("léa arobase gmail point com.","coordinates",["email"]),{email:"lea@gmail.com"});
 assert.deepEqual(extract("noémie arobase orange point fr","coordinates",["email"]),{email:"noemie@orange.fr"});
 assert.deepEqual(extract("Léa@Gmail.com","coordinates",["email"]),{email:"lea@gmail.com"});
 assert.deepEqual(extract("marc arobase example point test","contact",["contactEmail"]),{contactEmail:"marc@example.test"});
 assert.deepEqual(extract("marc@example.test","contact"),{contactEmail:"marc@example.test"},"étape contact : l'e-mail du candidat n'est pas écrasé");
 assert.deepEqual(extract("marc@example.test","coordinates"),{email:"marc@example.test"});
});
test("Extraction : choix par libellé, masculin, synonyme, négation, ordinal ou numéro",()=>{
 for(const [t,v] of [["française","francaise"],["je suis français","francaise"],["étranger","etrangere"],["étrangère","etrangere"],["je ne suis pas française","etrangere"],["la deuxième","etrangere"],["2","etrangere"],["la première","francaise"]])assert.deepEqual(extract(t,"nationality",["nationality"]),{nationality:v},t);
 for(const [t,v] of [["à mon nom","own"],["c’est à mon nom","own"],["chez moi","own"],["chez mes parents","parents"],["hébergé chez ma mère","parents"],["pas chez mes parents","own"],["le 2","own"],["option 1","parents"]])assert.deepEqual(extract(t,"home",["home"]),{home:v},t);
 assert.deepEqual(extract("carte d’identité","identityDocument",["identityDocument"]),{identityDocument:"cni_fr"});
 assert.deepEqual(extract("passeport","identityDocument",["identityDocument"]),{identityDocument:"passeport_fr"});
 const foreign=catalog({...candidate,nationality:"etrangere"}).flatMap(s=>s.fields);
 assert.deepEqual(localExtract("une carte d’identité italienne",foreign,[],["identityDocument"]),{identityDocument:"cni_europe"});
 assert.deepEqual(localExtract("un titre de séjour",foreign,[],["identityDocument"]),{identityDocument:"sejour"});
 assert.deepEqual(localExtract("un passeport étranger",foreign,[],["identityDocument"]),{identityDocument:"passeport_etranger"});
 const europe=catalog({...candidate,nationality:"etrangere",identityDocument:"cni_europe"}).flatMap(s=>s.fields);
 for(const [t,v] of [["je suis étudiante","student"],["salarié","worker"],["je travaille","worker"],["la première","student"],["2","worker"]]){
  assert.deepEqual(localExtract(t,europe,[],["europeSituation"]),{europeSituation:v},t);
 }
 assert.deepEqual(localExtract("autre situation",europe,[],["europeSituation"]),{});
 for(const [t,v] of [["un avis d’impôt","impot"],["une quittance","loyer"],["une facture","facture"]])assert.deepEqual(extract(t,"homeFiles",["homeProof"]),{homeProof:v},t);
 assert.deepEqual(extract("autre","specialFiles",["specialReason"]),{specialReason:"other"});
 const home=fields.find(f=>f.key==="home");
 assert.equal(matchOption(home," la deuxième ",true),"own");assert.equal(matchOption(home," la deuxième ",false),"");
});
test("Extraction : un chiffre ou une date ne remplit plus les champs à choix hors question",()=>{
 assert.deepEqual(extract("2","identity",["birthName"]),{});
 assert.deepEqual(extract("2 mai 2004","home",["home"]),{});
 assert.deepEqual(extract("j’habite au 2 rue de la paix","home",["home"]),{});
 assert.deepEqual(extract("le 2 mai 2004","identity",["birthDate"]),{birthDate:"2004-05-02"});
 assert.deepEqual(extract("06 12 34 56 78","coordinates",["phone"]),{phone:"0612345678"});
});
test("Extraction : oui / non par position, réservé à la question posée",()=>{
 for(const [t,v] of [["oui","oui"],["non","non"],["non merci","non"],["rien de particulier","non"],["oui, pas de problème","oui"],["je n’ai pas de handicap","non"],["non, aucun","non"],["bien sûr","oui"]])assert.deepEqual(extract(t,"special",["special"]),{special:v},t);
 assert.deepEqual(extract("oui","identity"),{});
 assert.ok(isYesNo(fields.find(f=>f.key==="special")));assert.ok(!isYesNo(fields.find(f=>f.key==="home")));
});
test("Marqueurs : je ne sais pas, c'est fait, oui/non détectable, mots vides",()=>{
 for(const t of ["je ne sais pas","Je sais pas","j’sais pas","passe","suivant","non merci","aucune idée","pas maintenant"])assert.ok(SKIP.test(apos(t)),t);
 for(const t of ["passeport","je n’ai pas son mail","rien","suivante étape non"])assert.ok(!SKIP.test(apos(t)),t);
 for(const t of ["je n’ai pas le document","rien","je ne sais pas"])assert.ok(SKIP_FILES.test(apos(t)),t);
 for(const t of ["c’est fait","C’est bon","voilà","terminé","ok c’est bon","fait"])assert.ok(DONE.test(apos(t)),t);
 for(const t of ["faites","ajouter"])assert.ok(!DONE.test(t),t);
 for(const t of ["non merci","rien","oui"])assert.ok(YES_NO_HINT.test(t),t);
 for(const t of ["je ne sais pas","pas maintenant"])assert.ok(!YES_NO_HINT.test(t),t);
 for(const t of ["euh","Euhhh","ben","ok","d’accord"])assert.ok(FILLER.test(apos(t)),t);
 assert.ok(!FILLER.test("Durand"));
});
test("Guide par mots-clés : 20 questions typiques",()=>{
 const expected=[
 ["Quelles formations proposez-vous ?","formations"],["Vous faites la formation post-permis ?","formations"],["Je veux apprendre à conduire pour le permis B","formations"],
 ["Où est l’agence ?","contact"],["c’est où ?","contact"],["Quel est votre mail ?","contact"],["Quel est votre email ?","contact"],["Votre adresse ?","contact"],
 ["Bonjour","telephone"],["Merci beaucoup","telephone"],["Vous êtes ouverts aujourd’hui ?","horaires"],["À quelle heure ouvrez-vous ?","horaires"],["Vous êtes fermés le lundi ?","horaires"],
 ["Mes enfants peuvent-ils s’inscrire ?","inscription"],["Comment s’inscrire ?","inscription"],["C’est quoi le dossier ANTS ?","inscription"],
 ["J’ai perdu mon permis","apres"],["Conduite accompagnée à 15 ans ?","formations"],["Je suis en situation de handicap","telephone"],["Le forfait coûte combien ?","tarifs"]
 ];
 for(const [q,first] of expected){const r=guideReply(q);assert.equal(r.actions[0],first,q);assert.equal(r.source,"guide");assert.ok(r.reply.length>20);}
 // « vous », « aujourd'hui », « enfants », « heures » ne routent plus vers contact, inscription ou horaires.
 assert.equal(guideReply("Merci à vous").actions[0],"telephone");
 assert.equal(guideReply("Combien d’heures de conduite ?").actions[0],"tarifs");
});
test("chat-server : parseReply ne renvoie jamais du JSON brut, normalizeMessages filtre le non-texte",()=>{
 assert.deepEqual(parseReply('{"reply":"Bonjour","actions":["tarifs","nope"]}'),{reply:"Bonjour",actions:["tarifs"]});
 assert.deepEqual(parseReply('Voici : {"reply":"Salut","actions":[]} fin'),{reply:"Salut",actions:[]});
 for(const raw of ['{"reply":"tronqu','{"reply":""}','{}','',"   ",'{"actions":["tarifs"]}',null,undefined])assert.equal(parseReply(raw),null,String(raw));
 assert.deepEqual(parseReply("Texte simple"),{reply:"Texte simple",actions:[]});
 assert.equal(normalizeMessages("x"),null);assert.equal(normalizeMessages([]),null);
 assert.equal(normalizeMessages([{role:"user",content:{a:1}}]),null);
 assert.equal(normalizeMessages([{role:"user",content:42}]),null);
 assert.deepEqual(normalizeMessages([{role:"assistant",content:"a"},{role:"user",content:"b"},{role:"user",content:"c"}]),[{role:"user",content:"b\nc"}]);
 assert.deepEqual(normalizeMessages([{role:"user",content:"b"},{role:"assistant",content:{x:1}},{role:"user",content:" c  "}]),[{role:"user",content:"b\nc"}]);
 assert.equal(normalizeMessages([{role:"user",content:"b"},{role:"assistant",content:"x"}]),null,"le dernier message doit être celui de l'utilisateur");
 assert.equal(normalizeMessages([{role:"user",content:"x".repeat(1500)}])[0].content.length,1000);
});

test("Extraction : type de demande du parcours Permis (premier permis / renouvellement)",()=>{
 const permis=catalog({...candidate,workflow:"permis",birthDate:"2000-03-12",home:"own",medical:"non"});
 const pf=permis.flatMap(s=>s.fields);
 const kp=permis.find(s=>s.id==="permitType").fields.map(f=>f.key);
 const x=t=>localExtract(t,pf,kp,["permitType"]).permitType;
 for(const t of ["premier permis","j’ai réussi l’examen","c’est mon premier permis, j’ai le certificat","cepc"])assert.equal(x(t),"first",t);
 for(const t of ["renouvellement","j’ai perdu mon permis","mon permis est abîmé","renouveler mon permis actuel"])assert.equal(x(t),"renewal",t);
});
