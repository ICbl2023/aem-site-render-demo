// Extraction locale de l'assistant de saisie (assist.js) : logique pure, sans DOM, testable en Node (tests/assist.test.js).
// Les frontières de mots utilisent (?<![a-zà-ÿ]) / (?![a-zà-ÿ]) : \b ne fonctionne pas autour des lettres accentuées.
export const MONTHS={janvier:1,fevrier:2,février:2,mars:3,avril:4,mai:5,juin:6,juillet:7,aout:8,août:8,septembre:9,octobre:10,novembre:11,decembre:12,décembre:12};
const MONTH_RE="janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre";
// « Je ne sais pas » sur une question ; « rien » et « je n'ai pas » ne valent que pour les fichiers (SKIP_FILES).
export const SKIP=/^\s*((?:je |j')(?:ne )?sais pas|passe|passer|suivant|non merci|aucune? id[ée]e|pas maintenant)(?![a-zà-ÿ])/i;
export const SKIP_FILES=/^\s*((?:je |j')(?:ne )?sais pas|passe|passer|suivant|je n'?ai pas|non merci|aucune? id[ée]e|rien|pas maintenant)(?![a-zà-ÿ])/i;
export const DONE=/(?<![a-zà-ÿ])(c'?est fait|fait|termin[ée]e?|ok c'?est bon|ajout[ée]e?|voil[àa]|c'?est bon)(?![a-zà-ÿ])/i;
// Mots vides : jamais pris pour un nom en réponse courte.
export const FILLER=/^(oui|ouais|non|nan|euh+|ben|bah|ok|d'accord|quoi|pardon|r[ée]p[èe]te|hein|comment|attends?|alors|voil[àa]|merci|yes|no)$/i;
// Un oui/non clairement exprimé (sans « pas », présent dans « je ne sais pas »).
export const YES_NO_HINT=/(?<![a-zà-ÿ])(oui|ouais|yes|non|nan|aucune?|jamais|rien)(?![a-zà-ÿ])/i;
const YES=/(?<![a-zà-ÿ])(oui|ouais|yes|bien s[uû]r|exact|effectivement|tout [àa] fait)(?![a-zà-ÿ])/;
const NO=/(?<![a-zà-ÿ])(non|nan|pas|aucune?|jamais|rien)(?![a-zà-ÿ])/;
export const DATE_FIELDS=["birthDate","identityExpiry","hostingDate","parentExpiry"];
export const NAME_FIELDS=["birthName","firstName","contactName"];
// Synonymes par champ à choix, consultés avant les libellés, uniquement pour le champ attendu ou l'étape en cours.
// Une valeur absente des options du champ est ignorée (cni_fr / cni_origine selon la nationalité).
const CNI=/(?:^|\s)cni(?![a-zà-ÿ])|carte (?:nationale )?d'?identit/;
export const SYNONYMS={
 nationality:[[/fran[cç]ais/,"francaise"],[/[ée]trang/,"etrangere"]],
 home:[[/(?:^|\s)[àa] mon nom(?![a-zà-ÿ])|mon propre|chez moi(?![a-zà-ÿ])|moi[- ]m[êe]me/,"own"],[/parents?(?![a-zà-ÿ])|h[ée]berg|chez (?:ma m[eè]re|mon p[eè]re)/,"parents"]],
 identityDocument:[[/europ[ée]|italien|espagnol|allemand|portugais|belge|suisse/,"cni_europe"],[CNI,"cni_fr"],[CNI,"cni_origine"],[/s[ée]jour/,"sejour"]],
 europeSituation:[[/[ée]tudiant/,"student"],[/salari|[ée]mploi|travaille|travail/,"worker"]],
 homeProof:[[/imp[oô]t|imposition/,"impot"],[/quittance|loyer/,"loyer"],[/facture/,"facture"]],
 specialReason:[[/(?:^|\s)autre(?![a-zà-ÿ])/,"other"],[/m[ée]dic/,"medical"],[/handicap|affection/,"handicap"],[/d[ée]j[àa]|existant|existe/,"existing"]]
};

export function isoDate(d,m,y){if(y<100)y+=y<30?2000:1900;if(m<1||m>12||d<1||d>31)return "";return String(y)+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");}
// Dates chiffrées (12/03/2004, 12-03-04), en lettres (12 mars 2004) et, si allowSpaces, dictées « 12 03 2004 ».
export function findDates(text,allowSpaces=false){
 const out=[];
 for(const m of text.matchAll(/(\d{1,2})\s*(?:\/|-|\.)\s*(\d{1,2})\s*(?:\/|-|\.)\s*(\d{2,4})/g))out.push({iso:isoDate(+m[1],+m[2],+m[3]),index:m.index});
 for(const m of text.matchAll(new RegExp("(\\d{1,2})(?:er)?\\s+("+MONTH_RE+")\\s+(\\d{4})","gi")))out.push({iso:isoDate(+m[1],MONTHS[m[2].toLowerCase()]||0,+m[3]),index:m.index});
 if(allowSpaces)for(const m of text.matchAll(/(?<!\d)(\d{1,2})\s+(\d{1,2})\s+(\d{4})(?!\d)/g))out.push({iso:isoDate(+m[1],+m[2],+m[3]),index:m.index});
 return out.filter(d=>d.iso);
}
export function findMonth(text){
 const m=text.match(new RegExp("("+MONTH_RE+")\\s+(\\d{4})","i"));
 if(m)return String(m[2])+"-"+String(MONTHS[m[1].toLowerCase()]||0).padStart(2,"0");
 const n=text.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);if(n && +n[1]>=1 && +n[1]<=12)return n[2]+"-"+String(+n[1]).padStart(2,"0");
 return "";
}
export function capitalize(s){return s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g,(x,a,b)=>a+b.toUpperCase());}
export const isYesNo=field=>field.type==="choice" && field.options.length===2 && field.options.every(o=>["oui","non"].includes(o[0]));
const wordsOf=label=>label.toLowerCase().replace(/\(.*?\)/g," ").split(/[^a-zà-ÿ0-9]+/).filter(w=>w.length>3 && !["votre","avec","dans","pour","sans","cette","autre","mais","vous","mon","mes"].includes(w));
// Négation juste avant une position : « pas (de/la/chez mes) … », « aucun … », « sans … ».
const negated=(lower,index)=>/(?:pas|aucune?|sans|jamais|ni)(?:\s+(?:d[eu']|de la|des|le|la|l'|les|un|une|mon|ma|mes|chez(?: mes| ma| mon)?))?\s*$/.test(lower.slice(Math.max(0,index-40),index));
export function matchOption(field,lower,strict){
 const values=field.options.map(o=>o[0]);
 if(strict)for(const [re,value] of SYNONYMS[field.key]||[]){
 if(!values.includes(value))continue;
 const m=lower.match(re);if(!m)continue;
 if(!negated(lower,m.index+(/^\s/.test(m[0])?1:0)))return value;
 if(values.length===2)return values.find(v=>v!==value);
 }
 // Ordinal en lettres, ou chiffre 1 à 4 formant toute la réponse : seulement pour le champ attendu (jamais un jour de date ni un numéro de rue).
 const ordinal=strict?(lower.match(/\b(premi[eè]re?|deuxi[eè]me|troisi[eè]me|quatri[eè]me)\b/) || lower.match(/^\s*(?:c'est |le |la |numéro |option |choix )?([1-4])\s*$/)):null;
 if(ordinal){const idx={premier:0,première:0,premiere:0,deuxième:1,deuxieme:1,troisième:2,troisieme:2,quatrième:3,quatrieme:3,"1":0,"2":1,"3":2,"4":3}[ordinal[1]];if(field.options[idx])return field.options[idx][0];}
 let best=null;
 for(const [value,label] of field.options){
 const others=new Set(field.options.filter(o=>o[0]!==value).flatMap(o=>wordsOf(o[1])));
 const distinct=wordsOf(label).filter(w=>!others.has(w));
 if(!distinct.length)continue;
 const hits=distinct.filter(w=>{const i=lower.indexOf(w);return i>=0 && !negated(lower,i);});
 const enough=strict?hits.length>=1:(hits.length>=2 || (distinct.length===1 && distinct[0].length>=8 && hits.length===1 && distinct[0]!=="justificatif"));
 if(enough && (!best || hits.length>best.hits))best={value,hits:hits.length};
 }
 return best?best.value:"";
}
// fields : catalogue {key,label,type,options} du parcours ; currentKeys : champs de l'étape en cours ; expected : champ de la question posée.
export function localExtract(text,fields,currentKeys=[],expected=[]){
 const values={},t=" "+text.replace(/[’‘]/g,"'").replace(/\s+/g," ")+" ",lower=t.toLowerCase();
 const has=key=>fields.some(f=>f.key===key);
 const byKey=Object.fromEntries(fields.map(f=>[f.key,f]));
 // E-mail écrit ou épelé (« léa arobase gmail point com »), sur texte désaccentué ; routé vers le responsable si c'est lui qu'on demande.
 const plain=lower.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
 const email=plain.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
 const joined=plain.replace(/\s*\barobase\b\s*/g,"@").replace(/\s*\b(?:tiret bas|underscore)\b\s*/g,"_").replace(/\s*\bpoint\b\s*/g,".").replace(/\s*\btiret\b\s*/g,"-");
 const spoken=joined.match(/(?:^|\s)([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?=[\s.,;!?]|$)/);
 const found=email?.[0]||spoken?.[1];
 if(found){
 const emailKey=has("contactEmail") && (expected.includes("contactEmail") || (!expected.includes("email") && currentKeys.includes("contactEmail")))?"contactEmail":has("email")?"email":"";
 if(emailKey)values[emailKey]=found;
 }
 const phones=[...t.replace(/[.\-]/g," ").matchAll(/(?:\+33\s?|0)\s?[1-9](?:\s?\d{2}){4}\b/g)].map(m=>m[0].replace(/\D/g,"").replace(/^33/,"0"));
 if(phones.length){
 if(expected.includes("contactPhone") && has("contactPhone"))values.contactPhone=phones[0];
 else if(has("phone"))values.phone=phones[0];
 if(phones[1] && has("contactPhone") && !values.contactPhone)values.contactPhone=phones[1];
 }
 const dates=findDates(t,expected.some(k=>DATE_FIELDS.includes(k)));
 for(const d of dates){
 const before=lower.slice(Math.max(0,d.index-60),d.index);
 if(/expir|valable|valid|p[ée]rim/.test(before) || expected.includes("identityExpiry")){if(has("identityExpiry"))values.identityExpiry=d.iso;}
 else if(/h[ée]berg/.test(before) || expected.includes("hostingDate")){if(has("hostingDate"))values.hostingDate=d.iso;}
 else if(expected.includes("parentExpiry") && has("parentExpiry"))values.parentExpiry=d.iso;
 else if(/(?<![a-zà-ÿ])n[ée]e?(?![a-zà-ÿ])|naissance/.test(before) && has("birthDate") && !values.birthDate)values.birthDate=d.iso;
 }
 if(!values.birthDate && dates.length===1 && has("birthDate") && (currentKeys.includes("birthDate") || expected.includes("birthDate")))values.birthDate=dates[0].iso;
 const month=findMonth(t);if(month && has("homeDate") && (expected.includes("homeDate") || /justificatif|facture|quittance|avis/.test(lower)))values.homeDate=month;
 // Nom et prénom : « je m'appelle Nolan Grayson », « mon nom (de naissance) est Durand », « prénom Léa ».
 let m=t.match(/je m'?appelle\s+([A-Za-zÀ-ÿ' -]{2,40}?)(?=[,.;]|\s+(?:je|n[ée]e?|mon|ma|et|j'|habite|au|le|la)(?![a-zà-ÿ])|$)/i);
 if(m){const parts=m[1].trim().split(/\s+/);if(parts.length>=2){if(has("firstName"))values.firstName=capitalize(parts[0]);if(has("birthName"))values.birthName=parts.slice(1).join(" ").toUpperCase();}else if(expected.includes("firstName") && has("firstName"))values.firstName=capitalize(parts[0]);}
 m=t.match(/(?<![a-zà-ÿ])(?:mon )?nom(?: de naissance)?(?! de naissance)\s*(?:est|:|c'est)?\s+([A-Za-zÀ-ÿ' -]{2,30}?)(?=[,.;]|\s+(?:et|mon|ma|je|pr[ée]nom)(?![a-zà-ÿ])|$)/i);
 if(m && has("birthName") && !values.birthName && !/pr[ée]nom/.test(m[0].toLowerCase()))values.birthName=m[1].trim().toUpperCase();
 m=t.match(/pr[ée]nom\s*(?:est|:|c'est)?\s+([A-Za-zÀ-ÿ' -]{2,30}?)(?=[,.;]|\s+(?:et|mon|ma|je|n[ée]e?)(?![a-zà-ÿ])|$)/i);
 if(m && has("firstName") && !values.firstName)values.firstName=capitalize(m[1].trim());
 for(const f of fields.filter(f=>f.type==="choice")){
 const current=currentKeys.includes(f.key) || expected.includes(f.key);
 if(isYesNo(f)){
 if(!current)continue;
 const yes=lower.search(YES),no=lower.search(NO);
 if(no>=0 && (yes<0 || no<yes))values[f.key]="non";else if(yes>=0)values[f.key]="oui";
 continue;
 }
 const v=matchOption(f,lower,current);if(v)values[f.key]=v;
 }
 // Réponse courte à une question précise : nom, prénom ou nom du responsable (« mon père, Jean Dupont »).
 const bare=t.trim().replace(/^(?:c'?est|je suis|moi c'?est|alors|euh+|ben|bah)\s+/i,"").replace(/^(?:mon p[eè]re|ma m[eè]re|mon tuteur|ma tutrice|mon responsable)\s*[,:]?\s*(?:c'?est\s+)?/i,"").replace(/[.!?]+$/,"").trim();
 if(bare && bare.length>=2 && bare.length<=40 && /^[A-Za-zÀ-ÿ' -]+$/.test(bare) && !/\d|@/.test(t) && !FILLER.test(bare) && !/(?<![a-zà-ÿ])(nom|pr[ée]nom|appelle)(?![a-zà-ÿ])/.test(lower)){
 const key=expected.find(k=>NAME_FIELDS.includes(k) && !values[k]);
 if(key && byKey[key])values[key]=key==="birthName"?bare.toUpperCase():capitalize(bare);
 }
 return values;
}
