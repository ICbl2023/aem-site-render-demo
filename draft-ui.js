import {DRAFT_DAYS} from "./drafts.js";
import {createRemoteDraftStore} from "./draft-remote.js";
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const action=(label,fn)=>{const b=node("button","secondary-button",label);b.type="button";b.addEventListener("click",fn);return b;};
const date=value=>new Date(value).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
export function createDraftSession({workflow,card,snapshot,restore,reset,render,store:givenStore}={}){
 const notify={fn:()=>{}};
 const store=givenStore||createRemoteDraftStore(workflow,{notify:(text,state)=>notify.fn(text,state)});
 const bar=node("aside","draft-bar");bar.setAttribute("aria-label","Sauvegarde du questionnaire");
 const status=node("p","draft-status");status.id="draft-status";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
 const info=node("p","validation-hint");
 const retry=action("Réessayer la sauvegarde",()=>{dirty=true;changed++;flush();});retry.hidden=true;
 const restart=action("Recommencer",restartDraft);restart.hidden=true;
 const linkBox=createLinkBox();
 bar.append(status,info,linkBox.root,retry,restart);card.before(bar);
 // Le texte de repli décrit la portée réelle de la sauvegarde : elle change selon que le serveur accepte les brouillons partagés.
 const scopeText=()=>store.shared
  ?"Brouillon conservé "+DRAFT_DAYS+" jours, réponses et documents compris. Vous pouvez fermer la page et reprendre depuis n’importe quel téléphone, tablette ou ordinateur avec votre lien de reprise."
  :"Brouillon conservé sur cet appareil et dans ce navigateur pendant "+DRAFT_DAYS+" jours. Vous pouvez fermer la page et revenir plus tard au même endroit (même téléphone ou ordinateur, même navigateur).";
 // Lien de reprise : envoyé par e-mail, et affiché pour être copié ou transmis (un mineur le passe à son responsable).
 function createLinkBox(){
  const root=node("div","draft-link");root.hidden=true;
  const open=action("Recevoir mon lien pour continuer plus tard",()=>{panel.hidden=false;open.hidden=true;field.focus();});
  const panel=node("div","draft-link-panel");panel.hidden=true;
  const label=node("label","validation-hint","Adresse e-mail pour recevoir le lien");
  const field=node("input");field.type="email";field.id="draft-link-email";field.autocomplete="email";field.inputMode="email";field.placeholder="prenom.nom@exemple.fr";
  label.htmlFor=field.id;
  const feedback=node("p","validation-hint");feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");
  const hint=node("p","validation-hint","Transmettez ce lien à un parent ou à un proche s’il termine le dossier avec vous. Toute personne qui l’ouvre voit les réponses et les documents déjà déposés : ne le publiez pas.");
  const send=action("Envoyer le lien",async()=>{
   const email=field.value.trim();
   if(!email){feedback.textContent="Indiquez une adresse e-mail pour recevoir le lien.";return;}
   send.disabled=true;feedback.textContent="Envoi du lien en cours…";
   try{
    await store.sendLink(email);
    feedback.textContent="Lien envoyé à "+email+". Regardez aussi vos indésirables. Il reste valable "+DRAFT_DAYS+" jours après votre dernière modification.";
    field.value="";
   }catch(error){feedback.textContent=error.message||"Le lien n’a pas pu être envoyé. Réessayez dans un instant.";}
   send.disabled=false;
  });
  const copy=action("Copier le lien",async()=>{
   const url=store.resumeUrl();
   if(!url)return;
   // Safari iOS refuse souvent clipboard.writeText hors HTTPS strict : repli execCommand, puis affichage du lien.
   let copied=false;
   try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(url);copied=true;}}catch{}
   if(!copied){
    const field=node("textarea");field.value=url;field.setAttribute("readonly","");
    field.style.cssText="position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01";
    document.body.append(field);field.focus();field.select();
    try{copied=document.execCommand("copy");}catch{copied=false;}
    field.remove();
   }
   feedback.textContent=copied?"Lien copié. Collez-le dans un message pour le transmettre.":"Copie impossible depuis ce navigateur. Voici le lien à recopier : "+url;
  });
  panel.append(label,field,send,copy,feedback,hint);
  root.append(open,panel);
  return {
   root,
   sync(){
    root.hidden=!store.shared;
    if(root.hidden){panel.hidden=true;open.hidden=false;}
    if(!field.value && !panel.hidden){const email=snapshot().answers?.email;if(email)field.value=email;}
   }
  };
 }
 let submissionError=null,initialized=false,choice=null,revision=0,changed=0,lastAttempt=0,dirty=false,running=null,timer,expiryTimer,stopped=false,readFailed=false,returnedWithDraft=false;
 const markerKey="aem-confirmed:"+store.key;
 const marker=()=>{try{return localStorage.getItem(markerKey);}catch{return null;}};
 const forgetMarker=()=>{try{localStorage.removeItem(markerKey);}catch{}};
 function syncRestart(){restart.hidden=stopped || !returnedWithDraft;}
 function message(text,state="info"){status.textContent=text;bar.dataset.state=state;retry.hidden=stopped || (state!=="error" && !(state==="partial" && store.offline));syncRestart();linkBox.sync();bar.hidden=false;}
 notify.fn=(text,state)=>message(text,state);
 function savingError(error){if(["DRAFT_CONFLICT","DRAFT_GONE","DRAFT_UNVERIFIED"].includes(error.code))submissionError=error;message("Sauvegarde impossible : "+(submissionError?submissionError.message:"tes dernières modifications ne sont pas enregistrées. Garde cette page ouverte et réessaie."),"error");}
 function armExpiry(at){
  clearTimeout(expiryTimer);
  expiryTimer=setTimeout(async()=>{
   if(stopped || choice)return;
   stopped=true;clearTimeout(timer);if(running)await running;
   try{await store.remove(snapshot().draftId);revision=0;dirty=false;returnedWithDraft=false;reset();stopped=false;message("Le brouillon a expiré après "+DRAFT_DAYS+" jours et a été effacé.","info");render();}
   catch(error){stopped=false;savingError(error);}
  },Math.max(0,at-Date.now()));
 }
 function queue(){
  if(!initialized || choice || stopped)return;
  dirty=true;changed++;clearTimeout(timer);
  message("Sauvegarde du brouillon en cours…","saving");
  timer=setTimeout(flush,150);
 }
 async function flush(){
  clearTimeout(timer);
  if(running){await running;if(dirty && changed>lastAttempt && !stopped && !choice)return flush();return;}
  if(!dirty || !initialized || choice || stopped)return;
  const sequence=changed,value=snapshot();lastAttempt=sequence;dirty=false;
  // Copier la structure maintenant : les réponses et fichiers peuvent encore changer pendant l'écriture.
  value.answers=JSON.parse(JSON.stringify(value.answers));
  value.files=new Map([...value.files].map(([key,list])=>[key,[...list]]));
  value.missing=value.missing.map(item=>({...item}));
  running=(async()=>{
   try{
    const result=await store.save(value,revision);submissionError=null;
    if(!result.offline)revision=result.revision;
    readFailed=false;armExpiry(result.expiresAt);
    if(stopped)return;
    if(sequence!==changed)return;
    // Hors ligne : les réponses sont dans ce navigateur mais pas encore sur le serveur, donc pas encore reprenables ailleurs.
    if(result.offline)message("Réseau indisponible : tes réponses sont enregistrées sur cet appareil et seront envoyées au serveur dès le retour de la connexion.","partial");
    else if(result.tooLarge)message("Brouillon enregistré, mais tes documents n’ont pas pu être conservés pour la reprise : "+result.tooLarge,"partial");
    else if(result.filesPending)message("Brouillon enregistré. "+result.filesPending+" document(s) n’ont pas encore été transmis : ils restent sur cet appareil et seront envoyés à la prochaine sauvegarde.","partial");
    else if(result.missingCount)message("Brouillon enregistré — "+result.missingCount+" fichier(s) non conservé(s) : à ajouter de nouveau à la reprise.","partial");
    else if(result.uploaded)message("Brouillon enregistré avec "+result.uploaded+" document(s). Tu peux fermer cette page et reprendre depuis un autre appareil avec ton lien de reprise.","saved");
    else if(result.shared)message("Brouillon enregistré. Tu peux fermer cette page et reprendre plus tard, depuis cet appareil ou un autre avec ton lien de reprise.","saved");
    else message("Brouillon enregistré. Vous pouvez fermer cette page et revenir plus tard : vos réponses et documents seront repris à l’étape en cours (même appareil, même navigateur).","saved");
    info.textContent=result.offline
     ?"Dernière sauvegarde locale à "+date(result.savedAt)+". "+scopeText()
     :"Conservé jusqu’au "+date(result.expiresAt)+" ("+DRAFT_DAYS+" jours après la dernière modification). "+(result.shared?"Rouvrez ce lien, ou celui reçu par e-mail, pour continuer.":"Rouvrez le même lien pour continuer.");
   }catch(error){dirty=true;if(!stopped)savingError(error);}
  })();
  await running;running=null;
  // Seules de nouvelles modifications relancent automatiquement un échec.
  if(sequence!==changed && dirty && !stopped)return flush();
 }
 async function restartDraft(){
  if(snapshot().sending || stopped)return;
  if(!window.confirm("Effacer les réponses et fichiers de ton brouillon "+workflow.toUpperCase()+" et recommencer ? Cette action est définitive."))return;
  stopped=true;clearTimeout(timer);clearTimeout(expiryTimer);if(running)await running;
  try{
   await store.remove(choice?.record.draftId || (readFailed?undefined:snapshot().draftId));
   forgetMarker();submissionError=null;choice=null;revision=0;dirty=false;readFailed=false;returnedWithDraft=false;reset();stopped=false;
   message("Brouillon effacé. Tu peux commencer un nouveau questionnaire.");render();
  }catch(error){stopped=false;message("Effacement impossible. Ton brouillon a été conservé : réessaie avant de recommencer.","error");}
 }
 function applyLoaded(loaded){
  choice=null;revision=loaded.record.revision;returnedWithDraft=true;
  restore(loaded);armExpiry(loaded.record.expiresAt);
  if(loaded.conflict)message("Brouillon modifié sur un autre appareil : sa dernière version est affichée. Les modifications locales non synchronisées n’ont pas été fusionnées.","partial");
  else if(loaded.degraded)message("Réseau indisponible : brouillon repris depuis cet appareil. Tes dernières réponses saisies ailleurs pourraient manquer.","partial");
  else if(loaded.missing.length)message("Brouillon repris à ton étape — "+loaded.missing.length+" document(s) n’ont pas pu être récupérés. Ils sont à ajouter de nouveau ; tes réponses sont là.","partial");
  else if(loaded.downloads)message("Dossier repris à l’étape en cours, avec tes documents déjà photographiés.","saved");
  else message("Brouillon repris à l’endroit où tu t’étais arrêté. Tu peux continuer, ajouter des documents, puis revenir plus tard si besoin.","saved");
  info.textContent="Conservé jusqu’au "+date(loaded.record.expiresAt)+" ("+DRAFT_DAYS+" jours). « Recommencer » efface tout après confirmation.";
 }
 function gate(){
  if(!initialized)return true;
  if(!choice)return false;
  // Reprise manuelle si la restauration automatique a été reportée.
  card.replaceChildren();
  const box=node("div","step-content draft-resume");
  box.append(node("span","eyebrow","Questionnaire "+workflow.toUpperCase()),node("h1","","Reprendre où tu t’étais arrêté"),node("p","lead","Ton brouillon est enregistré (sauvegardé le "+date(choice.record.savedAt)+"). Tu peux continuer à différents moments avant l’envoi final à AEM."));
  box.append(node("p","validation-hint","« Reprendre mon questionnaire » te ramène à l’étape en cours. « Recommencer » efface tout après confirmation. Expiration : "+date(choice.record.expiresAt)+"."));
  if(choice.missing.length)box.append(node("p","field-error",choice.missing.length+" fichier(s) n’ont pas été conservés. Ils seront signalés pour que tu les ajoutes de nouveau ; tes autres réponses sont préservées."));
  const resume=action("Reprendre mon questionnaire",()=>{
   const saved=choice;applyLoaded(saved);render();
  });resume.className="next-button";resume.id="resume-draft";
  box.append(resume,action("Recommencer",restartDraft));card.append(box);
  document.querySelector(".journey")?.classList.add("journey-hidden");bar.hidden=true;return true;
 }
 async function init(){
  let resumePending=false;
  try{
   const loaded=await store.load();
   if(loaded.record && marker()===loaded.record.submissionId){
    await store.remove(loaded.record.draftId);forgetMarker();message("Ton précédent dossier a bien été envoyé ; son brouillon a été effacé.");
   }else if(loaded.record){
    // Reprise automatique : le candidat retrouve son étape sans clic obligatoire.
    applyLoaded(loaded);resumePending=Boolean(loaded.pending);
   }else message(loaded.expired?"Le brouillon a expiré après "+DRAFT_DAYS+" jours et a été effacé.":"Tes réponses et documents sont sauvegardés automatiquement. Tu peux remplir le dossier en plusieurs fois, sur plusieurs jours, et le reprendre depuis un autre appareil avec ton lien de reprise.");
  }catch(error){readFailed=true;returnedWithDraft=true;if(error.code==="DRAFT_UNVERIFIED")submissionError=error;message(submissionError?.message||"Le brouillon n’a pas pu être lu. Recharge cette page pour réessayer, ou recommence.","error");}
  initialized=true;if(!info.textContent)info.textContent=scopeText();render();
  if(resumePending && !store.offline)queue();
 }
 async function confirmed(submissionId){
  stopped=true;dirty=false;returnedWithDraft=false;clearTimeout(timer);clearTimeout(expiryTimer);
  try{localStorage.setItem(markerKey,submissionId);}catch{/* secours sans données personnelles si l'effacement IndexedDB échoue */}
  if(running)await running;clearTimeout(expiryTimer);
  try{
   await store.remove(snapshot().draftId);forgetMarker();
   message("Dossier envoyé — le brouillon et son lien de reprise ont été effacés.","sent");return true;
  }catch{
   message("Ton dossier a bien été envoyé, mais le brouillon n’a pas pu être effacé.","error");
   const clear=action("Effacer le brouillon envoyé",async()=>{if(await confirmed(submissionId))clear.remove();});
   bar.append(clear);return false;
  }
 }
 function fresh(){submissionError=null;stopped=false;dirty=false;revision=0;choice=null;returnedWithDraft=false;clearTimeout(expiryTimer);message("Tu peux commencer un nouveau questionnaire.");}
 document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flush();});
 window.addEventListener("pagehide",()=>{flush();});
 window.addEventListener("beforeunload",event=>{if(!stopped && (dirty || running)){flush();event.preventDefault();event.returnValue="";}});
 window.addEventListener("online",()=>{if(!initialized || choice || stopped || !store.offline)return;dirty=true;changed++;flush();});
 return {init,gate,queue,flush,confirmed,fresh,tokenHeader:()=>store.tokenHeader?.()||{},get submissionError(){return submissionError;},get blocked(){return !initialized || Boolean(choice);}};
}
