// Assistant du site : bouton flottant, panneau de conversation, réponses via /api/chat (IA ou guide par mots-clés).
// La conversation reste dans l'onglet (sessionStorage). Aucune donnée personnelle n'est demandée.
import {icon,labelWithIcon} from "./icons.js";
import {SITE_ACTIONS,guideReply} from "./guide.js";
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const STORE="aem-chat";
const WELCOME="Bonjour, je suis l’assistant de l’Auto-école Majolane. Je peux vous orienter vers la préparation de votre dossier ANTS, les formations, les tarifs, les horaires ou le contact.";
const SUGGESTIONS=[["Comment s’inscrire ?","inscription"],["Vos horaires","horaires"],["Les tarifs","tarifs"],["J’ai réussi mon examen","apres"]];

let history=[];
try{history=JSON.parse(sessionStorage.getItem(STORE)||"[]");}catch{history=[];}
const save=()=>{try{sessionStorage.setItem(STORE,JSON.stringify(history.slice(-20)));}catch{/* stockage indisponible */}};

const launcher=el("button","chat-launcher");launcher.type="button";launcher.setAttribute("aria-expanded","false");launcher.setAttribute("aria-controls","aem-chat");
launcher.setAttribute("aria-label","Besoin d’aide ? Ouvrir l’assistant du site");launcher.append(labelWithIcon("sparkle","Besoin d’aide ?",20));
const panel=el("section","chat-panel");panel.id="aem-chat";panel.hidden=true;panel.setAttribute("aria-label","Assistant du site");
const head=el("div","chat-head");const title=el("div");title.append(el("strong","","Assistant AEM"),el("small","","Orientation sur le site, sans données personnelles"));
const close=el("button","chat-close");close.type="button";close.setAttribute("aria-label","Fermer l’assistant");close.append(icon("arrowRight",20));
head.append(title,close);
const messages=el("div","chat-messages");messages.setAttribute("role","log");messages.setAttribute("aria-live","polite");
const form=el("form","chat-form");const input=el("input");input.type="text";input.maxLength=500;input.placeholder="Votre question…";input.setAttribute("aria-label","Votre question");input.autocomplete="off";
const send=el("button");send.type="submit";send.append(icon("send",20));send.setAttribute("aria-label","Envoyer");
form.append(input,send);
const note=el("p","chat-note","Assistant automatique : il oriente, il ne décide rien. Pour une situation personnelle, appelez le 04 78 31 79 85.");
panel.append(head,messages,form,note);
document.body.append(launcher,panel);

function bubble(role,text){const b=el("div","chat-bubble "+role,text);messages.append(b);messages.scrollTop=messages.scrollHeight;return b;}
function actions(list){
 if(!list?.length)return;
 const row=el("div","chat-actions");
 for(const a of list){const link=el("a","",a.label);link.href=a.href;if(!a.href.startsWith("tel:"))link.rel="noopener";row.append(link);}
 messages.append(row);messages.scrollTop=messages.scrollHeight;
}
function suggestions(){
 const row=el("div","chat-actions");
 for(const [label,id] of SUGGESTIONS){const b=el("button","",label);b.type="button";b.addEventListener("click",()=>ask(label,id));row.append(b);}
 messages.append(row);
}
function render(){
 messages.replaceChildren();
 bubble("bot",WELCOME);
 if(!history.length)suggestions();
 for(const m of history){bubble(m.role==="assistant"?"bot":"user",m.content);if(m.actions)actions(m.actions);}
}
let busy=false;
async function ask(text,localId){
 if(busy)return;const content=text.trim();if(!content)return;
 busy=true;send.disabled=true;
 history.push({role:"user",content});bubble("user",content);
 const pending=bubble("bot pending","L’assistant réfléchit…");
 try{
 const response=await fetch("./api/chat",{method:"POST",headers:{"Content-Type":"application/json","X-AEM-Request":"chat"},body:JSON.stringify({messages:history.map(m=>({role:m.role,content:m.content}))})});
 const data=await response.json().catch(()=>null);
 if(!response.ok || !data?.reply)throw new Error(data?.error||"indisponible");
 pending.remove();
 history.push({role:"assistant",content:data.reply,actions:data.actions});
 bubble("bot",data.reply);actions(data.actions);
 }catch(error){
 pending.remove();
 // Sans serveur (version statique) ou en cas de panne : guide local par mots-clés, jamais de réponse inventée.
 const guide=guideReply(content);
 const ids=localId && SITE_ACTIONS[localId]?[localId,...guide.actions.filter(a=>a!==localId)]:guide.actions;
 const reply=String(error.message).includes("Trop")?error.message:guide.reply;
 history.push({role:"assistant",content:reply,actions:ids.slice(0,3).map(id=>({label:SITE_ACTIONS[id].label,href:SITE_ACTIONS[id].href}))});
 bubble("bot",reply);actions(history.at(-1).actions);
 }finally{busy=false;send.disabled=false;save();input.focus();}
}
form.addEventListener("submit",event=>{event.preventDefault();const text=input.value;input.value="";ask(text);});
function toggle(open){
 panel.hidden=!open;launcher.setAttribute("aria-expanded",String(open));
 if(open){render();input.focus();}else launcher.focus();
}
// Téléphone : quand le clavier s'ouvre, le panneau se cale sur la zone visible au lieu de passer dessous.
if(window.visualViewport){
 const fit=()=>{if(panel.hidden)return;const vv=window.visualViewport;panel.style.maxHeight=Math.max(220,vv.height-90)+"px";panel.style.bottom=(window.innerHeight-vv.height-vv.offsetTop+76)+"px";};
 window.visualViewport.addEventListener("resize",fit);window.visualViewport.addEventListener("scroll",fit);
 const reset=()=>{panel.style.maxHeight="";panel.style.bottom="";};
 launcher.addEventListener("click",()=>{if(!panel.hidden)fit();else reset();});
 close.addEventListener("click",reset);
}
launcher.addEventListener("click",()=>toggle(panel.hidden));
close.addEventListener("click",()=>toggle(false));
document.addEventListener("keydown",event=>{if(event.key==="Escape" && !panel.hidden)toggle(false);});
