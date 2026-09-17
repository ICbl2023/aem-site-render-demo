// Assistant du site : route POST /api/chat. Répond avec Claude quand ANTHROPIC_API_KEY est configurée,
// sinon avec un guide par mots-clés. Aucune donnée personnelle demandée ni journalisée : seuls des compteurs sont conservés.
import Anthropic from "@anthropic-ai/sdk";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {SITE_ACTIONS,ACTION_IDS,guideReply} from "./guide.js";

const SYSTEM=`Tu es l’assistant du site de l’Auto-école Majolane (AEM), 46 rue de la République, 69330 Meyzieu (est lyonnais). Tu aides les visiteurs à trouver la bonne page ou la bonne action. Tu réponds en français, avec chaleur et concision (3 phrases maximum, vouvoiement systématique, même si le visiteur tutoie).

FAITS SUR L’AUTO-ÉCOLE (n’invente rien d’autre ; si tu ne sais pas, renvoie vers le téléphone 04 78 31 79 85 ou aem69330@gmail.com) :
- Plus de 25 ans d’expérience à Meyzieu, équipe de 5 formateurs en voiture, agrément préfectoral E 14 069 00120, école engagée dans la démarche de labellisation « Qualité des formations » de l’État (23 critères).
- Formations : permis B en boîte manuelle ou automatique (forfait boîte automatique sur devis après l’évaluation de départ, non affiché sur le site) ; le permis boîte automatique se transforme en permis boîte mécanique sans délai et sans examen ; conduite accompagnée (AAC) dès 15 ans ; conduite supervisée dès 18 ans après 20 h et le code, avec un rendez-vous préalable de 2 h ; formation accélérée en 4 semaines (tarif et calendrier après entretien) ; permis à 1 € par jour (prêt à intérêts pris en charge par l’État, 15 à 25 ans) ; formation post-permis de 7 h pour réduire la période probatoire ; cours théoriques thématiques le samedi 13 h-16 h sur inscription.
- Évaluation de départ obligatoire (60 min) avant contrat, sur le simulateur Oscar 2 ou en voiture ; contrat établi avec AEM après l’évaluation (outil d’AEM, en ligne ou sur place) ; aucune signature ni paiement sur ce site ; photos d’identité faites gratuitement sur place ; accès tram T3 (5 min à pied depuis Part-Dieu) ou bus 67 arrêt Salle des Fêtes. Jusqu’à 6 h de cours en simulateur dont 2 h offertes. Accès offert au site Codes Rousseau pour préparer le code.
- Rendez-vous (action "rdv") : par téléphone ou par e-mail prérempli depuis la page Rendez-vous ; la réservation en ligne de créneaux n’existe pas encore.
- Tarifs affichés sur le site : forfait permis B boîte manuelle 1389 €, forfait conduite accompagnée boîte manuelle 1499 €, évaluation 45 €, rendez-vous préalable 126 € (tarifs indicatifs, à confirmer en agence).
- Horaires du bureau : lundi 14 h-19 h ; mardi à vendredi 10 h-12 h et 14 h-19 h ; samedi 10 h-12 h. Leçons de conduite du lundi au vendredi de 8 h à 19 h, prise en charge possible à domicile, tram ou lycée.
- Personnes en situation de handicap : AEM n’est pas spécialisée ; orienter vers la MDPH ou des auto-écoles adaptées, et vers le téléphone d’AEM.

DÉMARCHES EN LIGNE (deux parcours distincts, ne pas les confondre) :
- Dossier ANTS (action "ants") : pour s’inscrire au permis et constituer son dossier de conduite auprès de l’Agence nationale des titres sécurisés ; l’élève répond à des questions, joint ses pièces (identité, domicile, ASSR/recensement/JDC selon l’âge) et AEM dépose la démarche. Page d’explication : action "inscription".
- Fabrication du permis (action "permis") : après la réussite à l’examen, pour la fabrication ou le renouvellement du titre ; pièces : identité, permis actuel, domicile, avis médical si nécessaire. Page d’explication : action "apres".
- Les pièces sont vérifiées à la main par AEM : rien n’est validé automatiquement.

RÈGLES :
- Ne demande jamais de données personnelles (nom, date de naissance, numéro de téléphone, adresse, documents). Si le visiteur en donne, dis-lui de les saisir dans le questionnaire sécurisé ou de les communiquer par téléphone, et ne les répète pas.
- Ne donne pas de conseils juridiques ou médicaux ; pour une situation particulière, renvoie vers l’agence.
- Horaires, tarifs, adresse : cite uniquement les valeurs listées ci-dessus, mot pour mot ; n’estime jamais un prix, un délai ou un créneau qui n’y figure pas, renvoie plutôt vers le téléphone.
- Reste sur le sujet de l’auto-école ; refuse poliment le reste. Si tu ne sais pas, dis-le et propose le téléphone (action "telephone") ou l’e-mail (action "email") : n’invente jamais.
- Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme {"reply":"…","actions":["id",…]} où actions contient 0 à 3 identifiants parmi : ${ACTION_IDS.join(", ")}. Choisis les actions qui font avancer le visiteur.`;

function cleanText(value,max){return String(value??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"").trim().slice(0,max);}
export function normalizeMessages(input){
 if(!Array.isArray(input))return null;
 const messages=input.slice(-12).filter(m=>typeof m?.content==="string").map(m=>({role:m?.role==="assistant"?"assistant":"user",content:cleanText(m?.content,1000)})).filter(m=>m.content);
 if(!messages.length || messages.at(-1).role!=="user")return null;
 // Alternance stricte user/assistant attendue par l'API.
 const merged=[];for(const m of messages){const last=merged.at(-1);if(last && last.role===m.role)last.content+="\n"+m.content;else merged.push({...m});}
 if(merged[0].role!=="user")merged.shift();
 return merged.length?merged:null;
}
// null : réponse vide, JSON tronqué ou sans texte -> repli sur le guide (jamais de JSON brut affiché au visiteur).
export function parseReply(text){
 const raw=String(text||"").trim();
 const start=raw.indexOf("{"),end=raw.lastIndexOf("}");
 if(start>=0){
 try{
 const data=JSON.parse(raw.slice(start,end+1));
 const reply=cleanText(data?.reply,1200);
 const actions=Array.isArray(data?.actions)?data.actions.filter(a=>ACTION_IDS.includes(a)).slice(0,3):[];
 return reply?{reply,actions}:null;
 }catch{return null;}
 }
 return raw?{reply:cleanText(raw,1200),actions:[]}:null;
}

export function createChat({config,dataDir}){
 const enabled=Boolean(config.aiEnabled);
 const client=enabled?new Anthropic():null;
 const rates=new Map();
 const statsFile=path.join(dataDir,"chat-stats.json");
 let stats=null;
 async function loadStats(){
 if(stats)return stats;
 try{stats=JSON.parse(await readFile(statsFile,"utf8"));}catch{stats={days:{}};}
 return stats;
 }
 async function count(kind){
 try{
 const s=await loadStats(),day=new Date().toISOString().slice(0,10);
 s.days[day]=s.days[day]||{messages:0,ai:0,guide:0,errors:0};
 s.days[day].messages++;s.days[day][kind]=(s.days[day][kind]||0)+1;
 const days=Object.keys(s.days).sort();while(days.length>90)delete s.days[days.shift()];
 await mkdir(dataDir,{recursive:true});await writeFile(statsFile,JSON.stringify(s));
 }catch{/* les statistiques ne doivent jamais bloquer une réponse */}
 }
 // Quota par route et par IP (clé préfixée) : le chat et l'assistant de saisie ne se pénalisent pas l'un l'autre.
 function allowed(key,limit){
 const now=Date.now();for(const [k,r] of rates)if(r.until<now)rates.delete(k);
 const r=rates.get(key)||{count:0,until:now+15*60*1000};r.count++;rates.set(key,r);
 return r.count<=limit;
 }
 async function answer(messages){
 const last=messages.at(-1).content;
 if(!client)return guideReply(last);
 try{
 const response=await client.messages.create({
 model:"claude-opus-5",
 max_tokens:600,
 output_config:{effort:"low"},
 system:[{type:"text",text:SYSTEM,cache_control:{type:"ephemeral"}}],
 messages
 },{timeout:25000,maxRetries:1});
 if(response.stop_reason==="refusal" || response.stop_reason==="max_tokens")return guideReply(last);
 const text=response.content.filter(b=>b.type==="text").map(b=>b.text).join("\n");
 const parsed=parseReply(text);
 return parsed?{...parsed,source:"ai"}:guideReply(last);
 }catch(error){
 const status=error instanceof Anthropic.APIError?error.status:"réseau";
 console.error("[chat] réponse IA indisponible ("+status+") : repli sur le guide.");
 return {...guideReply(last),source:"guide",degraded:true};
 }
 }
 async function summary(){
 const s=await loadStats(),days=Object.entries(s.days).sort().slice(-30);
 const total=days.reduce((acc,[,d])=>({messages:acc.messages+d.messages,ai:acc.ai+(d.ai||0),guide:acc.guide+(d.guide||0)}),{messages:0,ai:0,guide:0});
 return {enabled,last30Days:total,today:s.days[new Date().toISOString().slice(0,10)]||{messages:0,ai:0,guide:0}};
 }
const ASSIST_SYSTEM=`Tu extrais des informations d’un message écrit ou dicté en français par un candidat d’auto-école, pour remplir un formulaire administratif. Tu reçois la liste des champs (clé, libellé, type, options éventuelles, étape) et les valeurs déjà connues.
RÈGLES :
- Ne renvoie que ce qui est dit explicitement. N’invente jamais, ne complète jamais une valeur manquante, ne corrige pas l’orthographe d’un nom.
- Formats : dates AAAA-MM-JJ (type birthdate, date) ou AAAA-MM (type month) ; téléphone en chiffres sans espace (10 chiffres, commençant par 0) ; e-mail en minuscules ; nom de naissance en MAJUSCULES ; prénom avec majuscule initiale.
- Champ de type choice : renvoie exactement la valeur d’une option (première colonne), uniquement si le message y correspond sans ambiguïté. Pour les questions oui/non, ne réponds que si le message parle clairement de cette question.
- Un message peut concerner plusieurs étapes : renseigne tous les champs concernés.
- Si une question précise a été posée (champ attendu) et que la réponse est courte (« Durand », « le 12 mars 2004 », « oui »), elle concerne ce champ.
- Réponds UNIQUEMENT avec un objet JSON {"values":{"clé":"valeur"},"message":"une phrase courte et utile pour le candidat, au vouvoiement, par exemple ce qui manque encore, sans répéter les valeurs"}.`;
function assistPayload(body){
 const text=cleanText(body?.text,1500);
 const fields=Array.isArray(body?.fields)?body.fields.slice(0,60).map(f=>({key:cleanText(f?.key,60),label:cleanText(f?.label,120),type:cleanText(f?.type,20),step:cleanText(f?.step,120),options:Array.isArray(f?.options)?f.options.slice(0,12).map(o=>[cleanText(o?.[0],60),cleanText(o?.[1],120)]):[]})).filter(f=>f.key):[];
 const known=body?.known && typeof body.known==="object"?Object.fromEntries(Object.entries(body.known).slice(0,60).map(([k,v])=>[cleanText(k,60),cleanText(v,200)])):{};
 const current=Array.isArray(body?.current)?body.current.slice(0,12).map(c=>cleanText(c,60)):[];
 const expected=Array.isArray(body?.expected)?body.expected.slice(0,4).map(c=>cleanText(c,60)):[];
 return text && fields.length?{text,fields,known,current,expected}:null;
}
function checkedValues(raw,fields){
 const values={};if(!raw || typeof raw!=="object")return values;
 for(const f of fields){
 if(!(f.key in raw))continue;
 let v=cleanText(raw[f.key],200);if(!v)continue;
 if(f.type==="choice" && !f.options.some(o=>o[0]===v))continue;
 if(["birthdate","date"].includes(f.type) && !/^\d{4}-\d{2}-\d{2}$/.test(v))continue;
 if(f.type==="month" && !/^\d{4}-\d{2}$/.test(v))continue;
 if(f.type==="tel")v=v.replace(/\D/g,"");
 if(f.type==="email")v=v.toLowerCase();
 values[f.key]=v;
 }
 return values;
}

 return {
 enabled,
 summary,
 async handleAssist(req,res,{json,readBody,clientIp}){
 if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
 if(req.headers["x-aem-request"]!=="assist")return json(res,403,{error:"Requête refusée."});
 let body;try{body=JSON.parse(await readBody(req));}catch{return json(res,400,{error:"Message illisible."});}
 const payload=assistPayload(body);
 if(!payload)return json(res,400,{error:"Rien à analyser."});
 if(!client)return json(res,200,{local:true});
 if(!allowed("assist:"+clientIp(req),120))return json(res,429,{error:"Trop de demandes. Réessayez dans quelques minutes."});
 try{
 const response=await client.messages.create({
 model:"claude-opus-5",
 max_tokens:800,
 output_config:{effort:"low"},
 system:[{type:"text",text:ASSIST_SYSTEM,cache_control:{type:"ephemeral"}}],
 messages:[{role:"user",content:"CHAMPS :\n"+JSON.stringify(payload.fields)+"\nCHAMPS DE L’ÉTAPE EN COURS : "+JSON.stringify(payload.current)+"\nQUESTION POSÉE AU CANDIDAT (champ attendu, une réponse courte s’y rapporte) : "+JSON.stringify(payload.expected)+"\nDÉJÀ CONNU : "+JSON.stringify(payload.known)+"\nMESSAGE DU CANDIDAT :\n"+payload.text}]
 },{timeout:25000,maxRetries:1});
 if(response.stop_reason==="refusal")return json(res,503,{error:"Assistant indisponible pour ce message."});
 const text=response.content.filter(b=>b.type==="text").map(b=>b.text).join("\n");
 let data=null;try{data=JSON.parse(text.slice(text.indexOf("{"),text.lastIndexOf("}")+1));}catch{data=null;}
 // Réponse hors format : comptée en erreur, le navigateur bascule sur son extraction locale.
 if(!data || typeof data!=="object"){await count("errors");return json(res,200,{local:true});}
 await count("ai");
 return json(res,200,{values:checkedValues(data.values,payload.fields),message:cleanText(data.message,300)});
 }catch(error){
 const status=error instanceof Anthropic.APIError?error.status:"réseau";
 console.error("[assist] extraction IA indisponible ("+status+").");
 await count("errors");
 return json(res,200,{local:true});
 }
 },
 async handle(req,res,{json,readBody,clientIp}){
 if(req.method!=="POST")return json(res,405,{error:"Méthode non autorisée."});
 if(req.headers["x-aem-request"]!=="chat")return json(res,403,{error:"Requête refusée."});
 if(!allowed("chat:"+clientIp(req),40))return json(res,429,{error:"Trop de messages. Réessayez dans quelques minutes ou appelez le 04 78 31 79 85."});
 let body;try{body=JSON.parse(await readBody(req));}catch{return json(res,400,{error:"Message illisible."});}
 const messages=normalizeMessages(body?.messages);
 if(!messages)return json(res,400,{error:"Écrivez un message pour commencer."});
 const result=await answer(messages);
 await count(result.source==="ai"?"ai":"guide");
 return json(res,200,{reply:result.reply,actions:result.actions.map(id=>({id,...SITE_ACTIONS[id]})),source:result.source});
 }
 };
}
