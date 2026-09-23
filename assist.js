// Assistant de saisie du questionnaire : un onglet à part entière, à côté de l'onglet Formulaire. Une conversation simple, au vouvoiement :
// l'assistant pose les questions par messages, remplit les champs et fait avancer les
// étapes ; un suivi du dossier montre ce qui est déjà rempli. Les fichiers restent à joindre dans l'onglet Formulaire.
// L'extraction locale (sans serveur) vit dans assist-extract.js, module pur testé en Node.
import {icon,labelWithIcon} from "./icons.js";
import {localExtract,SKIP,SKIP_FILES,DONE,YES_NO_HINT,isYesNo} from "./assist-extract.js";
export {localExtract} from "./assist-extract.js";
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const form=()=>window.aemForm;

/* ---------- Questions, au vouvoiement, ton simple ---------- */
const QUESTIONS={
 birthName:{first:"Pour commencer, quel est votre nom de naissance ?",retry:"Indiquez simplement votre nom de naissance, par exemple « Durand »."},
 firstName:{first:"Et votre prénom ?",retry:"Votre prénom, simplement."},
 birthDate:{first:"Votre date de naissance ? Le jour, le mois et l’année.",retry:"Par exemple : « 12 mars 2004 » ou « 12/03/2004 »."},
 phone:{first:"Sur quel numéro de téléphone peut-on vous joindre ?",retry:"Un numéro à dix chiffres, comme « 06 12 34 56 78 »."},
 email:{first:"Et votre adresse e-mail ? Vous pouvez l’épeler, ou l’écrire ci-dessous.",retry:"Écrivez-la plutôt dans la case, c’est plus sûr pour une adresse e-mail."},
 nationality:{first:"Vous êtes de nationalité française ou étrangère ?",retry:"Répondez « française » ou « étrangère »."},
 identityDocument:{first:"Quel document d’identité avez-vous ?",retry:"Choisissez dans la liste :"},
 europeSituation:{first:"Avec une carte d’identité européenne : quelle est votre situation en France ? Étudiant(e), salarié(e) ou personne qui travaille, ou une autre situation ?",retry:"Répondez « étudiant », « salarié » / « je travaille », ou « autre situation »."},
 identityExpiry:{first:"Jusqu’à quand est-il valable ? Si vous ne savez pas, dites « je ne sais pas ».",retry:"La date de fin de validité, ou « je ne sais pas »."},
 contactName:{first:"Comme vous êtes mineur, qui peut-on contacter en cas de besoin ? Son nom et son prénom.",retry:"Le nom et le prénom de votre responsable."},
 contactPhone:{first:"Et son numéro de téléphone ?",retry:"Un numéro à dix chiffres."},
 contactEmail:{first:"Son adresse e-mail, si vous la connaissez ? Sinon dites « je ne sais pas ».",retry:"Une adresse e-mail, ou « je ne sais pas »."},
 home:{first:"Côté logement : êtes-vous hébergé chez vos parents, ou avez-vous un justificatif à votre nom ?",retry:"Dites « chez mes parents » ou « à mon nom »."},
 homeProof:{first:"Quel justificatif de domicile avez-vous : une facture, une quittance de loyer ou un avis d’imposition ?",retry:"Facture, quittance ou avis d’imposition ?"},
 homeDate:{first:"Indiquez la date de ce justificatif : mois et année pour une facture ou une quittance, année seule pour un avis d’imposition. Sinon dites « je ne sais pas ».",retry:"La date du document, ou « je ne sais pas »."},
 hostingDate:{first:"De quand date l’attestation d’hébergement ? Sinon dites « je ne sais pas ».",retry:"Une date, ou « je ne sais pas »."},
 parentExpiry:{first:"Jusqu’à quand la pièce d’identité de votre parent est-elle valable ? Sinon « je ne sais pas ».",retry:"Une date, ou « je ne sais pas »."},
 special:{first:"Dernière chose : votre situation demande-t-elle un justificatif particulier, par exemple médical ou de handicap ? Oui ou non.",retry:"Oui ou non ?"},
 specialReason:{first:"De quelle situation s’agit-il ?",retry:"Choisissez dans la liste :"},
 medical:{first:"Une visite médicale est-elle nécessaire dans votre cas ? Oui ou non.",retry:"Oui ou non ?"}
};
function optionList(field){return field.options.map(o=>o[1]).join(", ");}
function ask(field,attempt){
 const q=QUESTIONS[field.key];
 let text=attempt===0?(q?.first||"Pouvez-vous m’indiquer ceci : "+field.label.toLowerCase()+" ?"):(q?.retry||"Je n’ai pas compris. "+field.label+" ?");
 if(field.type==="choice" && (attempt>0 || !q))text+=" "+optionList(field)+".";
 return text;
}

/* ---------- Interface : onglets, vue assistant, suivi ---------- */
export function mountAssistant(){
 if(!form())return;
 const card=document.querySelector("#question-card");if(!card)return;

 // Onglets au-dessus de la carte : Formulaire (saisie manuelle) et Assistant (messages). Cachés sur l'écran d'accueil.
 const tabs=el("div","assist-tabs");tabs.setAttribute("role","tablist");tabs.setAttribute("aria-label","Façon de remplir le dossier");tabs.hidden=true;
 const tab=(name,label,hint,controls)=>{const b=el("button","assist-tab");b.type="button";b.setAttribute("role","tab");b.setAttribute("aria-selected","false");b.setAttribute("aria-controls",controls);b.append(icon(name,20));const t=el("span","assist-tab-text");t.append(el("strong","",label),el("small","",hint));b.append(t);return b;};
 const tabForm=tab("keyboard","Formulaire","Je remplis moi-même","question-card");
 const tabAssist=tab("pen","Assistant","En écrivant","aem-assist");
 tabs.append(tabForm,tabAssist);card.before(tabs);

 // Vue assistant : conversation à gauche, suivi du dossier à droite (empilés sur téléphone).
 const panel=el("section","assist-view");panel.id="aem-assist";panel.hidden=true;panel.setAttribute("role","tabpanel");panel.setAttribute("aria-label","Assistant de saisie");
 const head=el("div","assist-head");const headText=el("div");
 headText.append(el("p","eyebrow","Assistant AEM"),el("h2","","Remplissons votre dossier ensemble"),el("p","assist-intro","Je vous pose les questions une par une, vous répondez par message, et je remplis le formulaire pour vous."));
 const badge=el("span","assist-badge");head.append(headText,badge);
 const body=el("div","assist-body");
 const chat=el("div","assist-chat");
 const log=el("div","chat-messages");log.setAttribute("role","log");log.setAttribute("aria-live","polite");
 const formEl=el("form","chat-form");const input=el("input");input.type="text";input.maxLength=600;input.placeholder="Écrivez votre réponse ici…";input.setAttribute("aria-label","Votre réponse");input.autocomplete="off";
 const send=el("button");send.type="submit";send.append(icon("send",20));send.setAttribute("aria-label","Envoyer");formEl.append(input,send);
 const note=el("p","chat-note","Vos réponses écrites sont analysées pour remplir les champs (par un service d’intelligence artificielle si AEM l’a activé). Vérifiez les champs dans l’onglet Formulaire avant d’envoyer ; c’est aussi là que se joignent les fichiers.");
 chat.append(log,formEl,note);
 const track=el("details","assist-track");const trackSummary=el("summary");const trackTitle=el("span","assist-track-title");trackTitle.append(labelWithIcon("flag","Suivi du dossier",18));const trackCount=el("span","assist-track-count","");trackSummary.append(trackTitle,trackCount);
 const steps=el("ol","assist-steps");
 const toForm=el("button","secondary-button assist-to-form");toForm.type="button";toForm.append(labelWithIcon("keyboard","Voir le formulaire",18));
 track.append(trackSummary,steps,toForm);
 body.append(chat,track);panel.append(head,body);card.after(panel);
 const wide=matchMedia("(min-width: 901px)");const syncTrack=()=>{track.open=wide.matches;};syncTrack();wide.addEventListener("change",syncTrack);

 let pending=null,attempt=0,busy=false,opened=false,praise=0,view="form",generation=0;
 const askedOptional=new Set();
 const frDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split("-").reverse().join("/"):/^\d{4}-\d{2}$/.test(v)?v.split("-").reverse().join("/"):v;
 const display=(field,value)=>field.type==="choice"?(field.options.find(o=>o[0]===value)?.[1]||value):field.type==="tel"?value.replace(/(\d{2})(?=\d)/g,"$1 "):frDate(value);
 // Les réponses restent écrites, sans accès au micro ni lecture vocale.
 const say=async(text,cls="bot")=>{const b=el("div","chat-bubble "+cls,text);log.append(b);log.scrollTop=log.scrollHeight;renderTrack();return b;};
 const action=(label,fn)=>{const row=el("div","chat-actions");const b=el("button","",label);b.type="button";b.addEventListener("click",fn);row.append(b);log.append(row);log.scrollTop=log.scrollHeight;};
 const labelOf=key=>{for(const s of form().catalog())for(const f of s.fields)if(f.key===key)return f.label;return key;};
 const catalogFields=()=>form().catalog().flatMap(s=>s.fields.map(f=>({key:f.key,label:f.label,type:f.type,required:f.required,step:s.title,options:f.options||[]})));
 const fieldByKey=key=>catalogFields().find(f=>f.key===key);
 // Champ déjà rempli (à la main) et valide : la question en attente n'a plus lieu d'être.
 const filled=key=>Boolean(form().answers()[key]) && !form().state().missing.includes(key);
 const updateBadge=()=>{badge.replaceChildren();badge.append(labelWithIcon("pen","Mode messages",16));};

 /* Suivi du dossier : étapes du parcours, réponses déjà notées, compte des réponses obligatoires. */
 function renderTrack(){
 const catalog=form().catalog(),answers=form().answers(),state=form().state();
 const currentIndex=state.id==="summary"?catalog.length:catalog.findIndex(s=>s.id===state.id);
 let done=0,total=0;
 steps.replaceChildren();
 catalog.forEach((s,i)=>{
 const li=el("li","assist-step "+(i<currentIndex?"done":i===currentIndex?"current":"todo"));
 li.append(el("strong","",s.title));
 if(s.documents)li.append(el("span","assist-step-note",i<currentIndex?"Fichiers : voir le formulaire":"Fichiers à joindre dans le formulaire"));
 for(const f of s.fields){
 if(f.required)total++;
 const v=answers[f.key];if(v===undefined || v==="")continue;
 if(f.required)done++;
 if(i<=currentIndex){const row=el("div","assist-answer");row.append(el("span","",f.label),el("b","",display(f,v)));li.append(row);}
 }
 steps.append(li);
 });
 trackCount.textContent=done+" réponse"+(done>1?"s":"")+" sur "+total;
 }
 /* Onglets : visibles dès que le questionnaire a commencé, jamais sur l'accueil ni après l'envoi. */
 function updateTabs(){
 const hide=["welcome","resume"].includes(form().state().id) || Boolean(card.querySelector(".success-badge"));
 tabs.hidden=hide;
 if(hide && view==="assist")show("form");
 }
 function show(next){
 view=next;const assist=next==="assist";
 panel.hidden=!assist;card.hidden=assist;
 tabForm.setAttribute("aria-selected",String(!assist));tabAssist.setAttribute("aria-selected",String(assist));
 tabForm.tabIndex=assist?-1:0;tabAssist.tabIndex=assist?0:-1;
 if(assist){renderTrack();input.focus({preventScroll:true});if(opened && !busy)resume();}
 
 }
 // Retour dans l'onglet Assistant : on repart de l'état réel du formulaire (fichiers ajoutés, champ saisi à la main…).
 async function resume(){
 if(pending?.key==="__files"){
 if(form().state().ready){pending=null;await say("Parfait, c’est enregistré.");await nextQuestion();}
 
 return;
 }
 if(pending && filled(pending.key)){pending=null;attempt=0;}
 if(!pending)await nextQuestion();
 }
 tabForm.addEventListener("click",()=>show("form"));
 tabAssist.addEventListener("click",()=>{if(opened)show("assist");else start();});
 toForm.addEventListener("click",()=>show("form"));
 tabs.addEventListener("keydown",e=>{if(e.key==="ArrowRight" || e.key==="ArrowLeft"){e.preventDefault();(view==="assist"?tabForm:tabAssist).click();(view==="assist"?tabForm:tabAssist).focus();}});
 // Entrée dans la zone de réponse : envoi du message, jamais le raccourci « étape suivante » du questionnaire.
 input.addEventListener("keydown",e=>{if(e.key==="Enter")e.stopPropagation();});

  formEl.addEventListener("submit",event=>{event.preventDefault();const text=input.value.trim();input.value="";if(text)handle(text);});

 /* Choix du mode sur l'écran d'accueil du questionnaire ; les onglets et le suivi se mettent à jour à chaque rendu de la carte. */
 function offerModes(){
 const inject=()=>{
 updateTabs();if(!panel.hidden)renderTrack();
 const welcome=card.querySelector(".welcome-content");if(!welcome || welcome.querySelector(".assist-modes"))return;
 const box=el("div","assist-modes");
 box.append(el("p","assist-modes-title","Comment souhaitez-vous remplir votre dossier ?"));
 const row=el("div","assist-modes-row");
 const text=el("button","assist-mode");text.type="button";text.append(labelWithIcon("pen","En écrivant",20),el("small","","Une conversation par messages, je remplis pour vous."));
 const manual=el("button","assist-mode");manual.type="button";manual.append(labelWithIcon("keyboard","Moi-même",20),el("small","","Je remplis les champs à la main, étape par étape."));
 text.addEventListener("click",()=>start());
 manual.addEventListener("click",()=>{opened=false;form().next();});
 row.append(text,manual);box.append(row);
 const nav=welcome.querySelector(".navigation");if(nav)welcome.insertBefore(box,nav);else welcome.append(box);
 };
 inject();new MutationObserver(inject).observe(card,{childList:true});
 }

 /* Dialogue : une question à la fois, puis on avance. Rien ne continue quand l'onglet Formulaire est affiché. */
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function start(){
 // opened reste faux pendant l'ouverture : show() ne relance pas le dialogue avant le message d'accueil.
 opened=false;log.replaceChildren();pending=null;attempt=0;praise=0;askedOptional.clear();updateBadge();
 if(form().state().id==="welcome"){form().next();await wait(400);}
 updateTabs();show("assist");opened=true;
 panel.scrollIntoView({block:"start",behavior:"smooth"});
 await say("Bonjour ! Je vais vous poser quelques questions : répondez simplement par message. Je remplis le formulaire pour vous.");
 if(panel.hidden)return;
 await nextQuestion();
 }
 async function nextQuestion(){
 let guard=0;
 while(guard++<15){
 if(panel.hidden)return;
 const state=form().state();
 if(state.id==="summary"){pending=null;await say("Nous avons tout ! Ouvrez l’onglet Formulaire pour relire le récapitulatif, cocher la case de consentement et envoyer votre dossier. Bravo.");action("Relire et envoyer",()=>show("form"));return;}
 if(state.documents && !state.ready){
 pending={key:"__files",label:state.title};attempt=0;
 await say("Il faut maintenant ajouter vos fichiers pour « "+state.title.replace(/^Ajoutez /,"").replace(/^Vos? /,"")+" » : ouvrez l’onglet Formulaire, ajoutez la photo ou le PDF avec « Ajouter votre document » (ou cochez la case pour qu’AEM vous recontacte), puis revenez ici : je continue.");
 action("Ouvrir le formulaire",()=>show("form"));
 
 return;
 }
 if(!state.ready){
 const key=state.missing[0];const field=fieldByKey(key);
 if(!field){await say("Il manque « "+labelOf(key)+" » : pouvez-vous le saisir dans l’onglet Formulaire ?");action("Ouvrir le formulaire",()=>show("form"));return;}
 pending={key,label:field.label};attempt=0;
 await say(ask(field,0));
 
 return;
 }
 // Champs facultatifs de l'étape (date d'expiration, mois du justificatif, e-mail du responsable…) : demandés une seule fois.
 const optional=(state.optional||[]).find(k=>!askedOptional.has(k));
 const optionalField=optional?fieldByKey(optional):null;
 if(optionalField){
 askedOptional.add(optional);pending={key:optional,label:optionalField.label};attempt=0;
 await say(ask(optionalField,0));
 
 return;
 }
 form().next();await wait(600);
 const after=form().state();
 if(after.id===state.id)return;
 }
 }
 async function extract(text){
 const fields=catalogFields(),state=form().state();
 const currentKeys=form().catalog().find(s=>s.id===state.id)?.fields.map(f=>f.key)||[];
 const expected=pending && pending.key!=="__files"?[pending.key]:[];
 const local=localExtract(text,fields,currentKeys,expected);
 try{
 const response=await fetch("./api/assist",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Request":"assist"},body:JSON.stringify({text,fields,current:currentKeys,expected,known:form().answers()})});
 if(response.status===429)return {values:local,message:"L’analyse assistée est en pause quelques minutes, je continue sans elle."};
 const data=await response.json().catch(()=>null);
 // L'IA a priorité, l'extraction locale complète ce qu'elle a manqué ; form().apply revalide tout.
 if(response.ok && data && data.values && typeof data.values==="object")return {values:{...local,...data.values},message:data.message||""};
 }catch{/* serveur absent : extraction locale */}
 return {values:local,message:""};
 }
 async function handle(text){
 if(busy || form().state().id==="resume")return;const turn=generation;busy=true;send.disabled=true;
 const user=el("div","chat-bubble user",text);log.append(user);log.scrollTop=log.scrollHeight;
 try{
 if(pending?.key==="__files"){
 if(DONE.test(text) || form().state().ready){if(form().state().ready){await say("Parfait, c’est enregistré.");pending=null;await nextQuestion();}else{await say("Je ne vois pas encore de fichier ni de case cochée. Ajoutez votre document dans l’onglet Formulaire, ou cochez « AEM me recontactera », puis revenez.");action("Ouvrir le formulaire",()=>show("form"));}}
 else if(SKIP_FILES.test(text)){await say("Pas de souci. Si cette pièce peut être fournie plus tard, cochez « Je n’ai pas ce document sous la main » juste sous son nom dans le formulaire : AEM vous recontactera. Sinon, il faudra la photographier.");action("Ouvrir le formulaire",()=>show("form"));}
 else{await say("Ajoutez d’abord votre fichier dans l’onglet Formulaire, puis revenez ici.");action("Ouvrir le formulaire",()=>show("form"));}
 
 return;
 }
 let field=pending?fieldByKey(pending.key):null;
 if(field && filled(field.key)){pending=null;attempt=0;field=null;}
 // « Je ne sais pas » : jamais pris pour un passage quand une question oui/non reçoit un oui ou un non.
 if(field && SKIP.test(text) && !(isYesNo(field) && YES_NO_HINT.test(text))){
 if(field.required){await say("Cette information est nécessaire pour le dossier. Vous pouvez aussi la saisir dans l’onglet Formulaire. "+ask(field,1));attempt++;}
 else{await say("D’accord, passons.");pending=null;await nextQuestion();}
 
 return;
 }
 // « Suivant » sans question en attente (champ rempli à la main) : on repart de l'état du formulaire.
 if(!field && SKIP.test(text)){await nextQuestion();return;}
 const {values,message}=await extract(text);
 if(turn!==generation)return;
 const result=form().apply(values);
 const got=field && result.applied.includes(field.key);
 if(got){
 const value=form().answers()[field.key];
 const extra=result.applied.filter(k=>k!==field.key).map(labelOf);
 await say(["Parfait","Super","Merci","C’est noté","Très bien"][praise++%5]+", "+field.label.toLowerCase()+" : "+display(field,value)+"."+(extra.length?" J’ai aussi noté : "+extra.join(", ")+".":""));
 pending=null;attempt=0;await nextQuestion();
 }else if(result.applied.length){
 await say("J’ai noté : "+result.applied.map(labelOf).join(", ")+". "+(field?ask(field,1):""));attempt++;
 if(!pending)await nextQuestion();
 
 }else if(field){
 attempt++;
 if(attempt>=3){await say("Je n’arrive pas à comprendre cette réponse. Saisissez « "+field.label+" » dans l’onglet Formulaire, puis revenez ici ou dites « suivant ».");action("Ouvrir le formulaire",()=>show("form"));}
 else await say((message||"Je n’ai pas bien saisi.")+" "+ask(field,attempt));
 
 }else{
 await say("Je n’ai rien à remplir avec cela. "+(form().state().ready?"Vous pouvez continuer.":"Répondez à la question ci-dessus, ou saisissez le champ dans le formulaire."));
 if(!pending)await nextQuestion();
 }
 }catch(error){await say("Je n’ai pas pu traiter ce message. Vous pouvez saisir les champs dans l’onglet Formulaire.");console.error(error);}
 finally{if(turn===generation){busy=false;send.disabled=false;if(!panel.hidden)input.focus({preventScroll:true});}}
 }
 // Jalon du questionnaire (le candidat avance ou remplit lui-même) : une question en attente déjà satisfaite est abandonnée.
 document.addEventListener("aem:milestone",()=>{if(pending && pending.key!=="__files" && filled(pending.key)){pending=null;attempt=0;}if(!panel.hidden)renderTrack();});
 document.addEventListener("aem:reset",()=>{
 generation++;opened=false;pending=null;attempt=0;busy=false;praise=0;askedOptional.clear();
 log.replaceChildren();input.value="";send.disabled=false;show("form");
 });
 updateBadge();offerModes();
}
if(typeof window!=="undefined" && typeof document!=="undefined")mountAssistant();
