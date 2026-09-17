import {newSubmissionId,workflows,limits,accept,acceptedExtensions,stepsFor,documentsFor,cleanAnswers,answerErrors,fieldError,ageFromDate,expiryStatus,documentAge,monthAge,displayValue,missingRequiredDocuments,deferredDocuments,isDeferred,isMinor,maskDate,dateFromInput,dateInputValue} from "./logic.js";
import {createDraftSession} from "./draft-ui.js";
import {icon,labelWithIcon} from "./icons.js";
const card=document.querySelector("#question-card");
const workflow=document.documentElement.dataset.workflow;
const welcomeInfo={
 ants:{title:"Votre dossier ANTS",why:"Vous préparez votre dossier de conduite auprès de l’Agence nationale des titres sécurisés : inscription au permis, échange ou demande liée à votre formation. AEM rassemble vos informations et vos pièces, puis dépose la démarche pour vous.",docs:["Pièce d’identité (recto et verso)","Justificatif de domicile de moins de 6 mois","ASSR, recensement ou JDC selon votre âge"]},
 permis:{title:"Votre dossier Permis",why:"Vous demandez la fabrication ou le renouvellement de votre permis de conduire. AEM vérifie vos pièces avec vous avant de transmettre la demande.",docs:["Pièce d’identité","Certificat d’examen (CEPC) pour un premier permis, ou permis actuel pour un renouvellement","Justificatif de domicile de moins de 6 mois","Avis médical si votre situation le demande"]}
};
let answers={workflow},files=new Map(),current="welcome",busy=false,sending=false,completed=false;
let lastMilestone=0,drafts,draftMissing=[],draftId=newSubmissionId();
let submissionId=newSubmissionId(),serverConfig=null,editMode=false;
let previewUrls=[];
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(text,cls,fn)=>{const b=el("button",cls,text);b.type="button";b.addEventListener("click",fn);return b;};
const totalSize=()=>[...files.values()].flat().reduce((sum,f)=>sum+f.size,0);
const totalCount=()=>[...files.values()].flat().length;
const sizeText=n=>n<1024?n+" octets":n<1024*1024?(n/1024).toLocaleString("fr-FR",{maximumFractionDigits:1})+" Ko":(n/1024/1024).toLocaleString("fr-FR",{maximumFractionDigits:2})+" Mo";
function releasePreviews(){previewUrls.forEach(URL.revokeObjectURL);previewUrls=[];}
function pathSteps(){return stepsFor(answers);}
function activeStep(){return stepsFor(answers).find(s=>s.id===current);}
function pruneFiles(){
 const docs=documentsFor(answers),allowed=new Set(docs.map(d=>d.key)),deferrable=new Set(docs.filter(d=>d.deferrable).map(d=>d.key));
 for(const key of files.keys())if(!allowed.has(key))files.delete(key);
 draftMissing=draftMissing.filter(item=>allowed.has(item.key));
 if(answers.deferred)answers.deferred=answers.deferred.filter(key=>deferrable.has(key));
}
function setDeferred(key,on){
 const list=(answers.deferred||[]).filter(k=>k!==key);
 if(on)list.push(key);
 if(list.length)answers.deferred=list;else delete answers.deferred;
 submissionId=newSubmissionId();drafts?.queue();
}
function changed(key,value){
 if(answers[key]===value)return;
 answers[key]=value;submissionId=newSubmissionId();
 if(key==="nationality"){
 delete answers.identityDocument;delete answers.identityExpiry;
 }
 if(key==="identityDocument")delete answers.identityExpiry;
 if(key==="home"){delete answers.homeProof;delete answers.homeDate;}
 if(key==="birthDate"){
 if(!value.trim() || ageFromDate(value)===null){delete answers.emancipated;delete answers.contactName;delete answers.contactPhone;delete answers.contactEmail;}
 else if(!isMinor({...answers,birthDate:value})){delete answers.contactName;delete answers.contactPhone;delete answers.contactEmail;delete answers.emancipated;}
 }
 if(key==="special")delete answers.specialReason;
 pruneFiles();
 updateNext();drafts?.queue();
}
function title(s,container){
 container.append(el("span","eyebrow",s.group));
 const h=el("h1","",s.title);h.tabIndex=-1;container.append(h);
 if(s.hint)container.append(el("p","lead",s.hint));
 else container.append(el("p","lead",s.fields.length?"Renseignez les informations ci-dessous.":""));
}
function fieldNode(f){
 const wrap=el("div","field-block");
 const error=el("p","field-error");error.id=f.key+"-error";error.hidden=true;
 const inputId="field-"+f.key;
 const showError=()=>{
 const message=fieldError(f,answers[f.key]);
 error.textContent=message;error.hidden=!message;
 const input=wrap.querySelector("input,textarea");if(input)input.setAttribute("aria-invalid",String(Boolean(message)));
 };
 if(f.type==="choice"){
 const fs=el("fieldset","choice-fieldset"),legend=el("legend","field-label",f.label);fs.append(legend);
 const choices=el("div","choice-list"+(f.key==="identityDocument"?" identity-choices":""));
 f.options.forEach(([value,label,hint])=>{
 const option=el("label","choice-card"+(answers[f.key]===value?" selected":""));
 const input=el("input","native-choice");input.type="radio";input.name=f.key;input.value=value;input.checked=answers[f.key]===value;input.required=f.required;
 input.addEventListener("change",()=>{
 changed(f.key,value);
 choices.querySelectorAll("label").forEach(n=>n.classList.toggle("selected",n.querySelector("input").checked));
 showError();
 if(f.key==="specialReason")refreshDocuments();

 updateProgress();
 });
 const copy=el("span");copy.append(el("strong","",label));if(hint)copy.append(el("small","",hint));
 option.append(input,copy);choices.append(option);
 });
 fs.append(choices);wrap.append(fs);
 }else{
 const label=el("label","field-label",f.label);label.htmlFor=inputId;wrap.append(label);
 if(["birthdate","date","month"].includes(f.type)){
 const kind=f.type==="month"?"month":"date",format=kind==="month"?"MM/AAAA":"JJ/MM/AAAA";
 const control=el("div","document-date-control");
 const input=el("input","text-input document-date-input");input.type="text";input.id=inputId;
 input.placeholder=format;input.inputMode="numeric";input.maxLength=kind==="month"?7:10;
 input.autocomplete=f.type==="birthdate"?"bday":"off";input.value=dateInputValue(answers[f.key],kind);
 input.setAttribute("aria-describedby",f.key+"-format "+error.id);input.required=f.required;
 const calendar=el("label","calendar-control");
 const icon=el("span");icon.setAttribute("aria-hidden","true");
 icon.innerHTML='<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18M7 15h3m4 0h3m-10 3h3"/></svg>';
 calendar.append(icon);
 const picker=el("input","native-calendar");picker.type=kind;picker.id=inputId+"-calendar";
 picker.dataset.calendar="true";picker.setAttribute("aria-label","Calendrier : "+f.label);
 calendar.htmlFor=picker.id;calendar.title="Ouvrir le calendrier";
 picker.value=answers[f.key]||"";calendar.append(picker);control.append(input,calendar);wrap.append(control);
 const hint=el("p","validation-hint",kind==="month"?"Saisissez le mois et l’année (MM/AAAA) au clavier ou avec le calendrier.":"Saisissez "+format+" au clavier ou utilisez le calendrier.");hint.id=f.key+"-format";
 const validity=el("p","date-feedback");validity.hidden=true;
 function feedback(){
 const value=answers[f.key];
 validity.hidden=!value;
 if(f.type==="birthdate"){
 const age=ageFromDate(value);
 validity.textContent=age===null?"Vérifiez la date saisie.":"Votre âge calculé : "+age+" ans.";
 }else validity.textContent=kind==="month"?monthAge(value):f.documentDate?documentAge(value):expiryLine(value);
 }
 input.addEventListener("keydown",event=>{
 const pos=input.selectionStart;
 if(event.key==="Backspace" && pos===input.selectionEnd && pos>1 && input.value[pos-1]==="/")input.setSelectionRange(pos-2,pos);
 });
 input.addEventListener("input",()=>{
 const masked=maskDate(input.value,kind,input.selectionStart);
 input.value=masked.text;input.setSelectionRange(masked.caret,masked.caret);
 changed(f.key,dateFromInput(input.value,kind));picker.value=answers[f.key]||"";
 feedback();if(!error.hidden)showError();updateProgress();
 });
 input.addEventListener("blur",()=>{input.value=dateInputValue(answers[f.key],kind);showError();});
 picker.addEventListener("click",()=>{try{picker.showPicker?.();}catch{/* Le sélecteur natif reste accessible. */}});
 picker.addEventListener("change",()=>{
 changed(f.key,picker.value);input.value=dateInputValue(picker.value,kind);
 feedback();showError();updateProgress();
 });
 if(picker.type!==kind)calendar.hidden=true;
 wrap.append(hint,validity);feedback();
 }else{
 const input=el(f.type==="textarea"?"textarea":"input","text-input");input.id=inputId;
 if(f.type!=="textarea")input.type=f.type;
 input.value=answers[f.key]||"";input.required=f.required;input.maxLength=f.type==="textarea"?2000:200;
 input.autocomplete={birthName:"family-name",firstName:"given-name",email:"email",phone:"tel"}[f.key]||"off";
 input.setAttribute("aria-describedby",error.id);
 input.addEventListener("input",()=>{changed(f.key,input.value);if(!error.hidden)showError();});
 input.addEventListener("blur",showError);wrap.append(input);
 }
 }

 wrap.append(error);return wrap;
}
function expiryLine(value){const status=expiryStatus(value);return status.detail+". Indicateur de date, à contrôler par AEM.";}
function refreshDocuments(){
 const host=document.querySelector("#document-list");if(!host)return;
 releasePreviews();host.replaceChildren();
 const s=activeStep();const docs=documentsFor(answers).filter(d=>d.group===s.documentGroup);
 for(const doc of docs){
 const deferred=doc.deferrable && !(files.get(doc.key)||[]).length && isDeferred(answers,doc.key);
 const article=el("article","document-card upload-card"+((files.get(doc.key)||[]).length?" received":"")+(deferred?" deferred":""));
 article.append(el("h2","",doc.label));
 if(doc.hint)article.append(el("p","lead",doc.hint));
 const status=el("p","file-status",(files.get(doc.key)||[]).length?"Fichier(s) sélectionné(s) — pas encore envoyé(s)":deferred?"Non fournie — AEM vous recontactera":"Aucun fichier sélectionné"+(doc.optional?" (facultatif)":""));
 article.append(status);
 if(doc.requiredUpload)article.append(el("p","validation-hint",doc.deferrable?"Joignez au moins un fichier, ou indiquez ci-dessous que vous ne l’avez pas sous la main.":"Joignez au moins un fichier pour continuer cette démarche."));
 const list=el("ul","file-list");
 (files.get(doc.key)||[]).forEach((file,index)=>{
 const row=el("li","file-row");
 const ext=file.name.split(".").pop().toLowerCase();
 const icon=el("span","file-icon",ext.toUpperCase());
 if(["jpg","jpeg","png","webp"].includes(ext)){
 const img=el("img","file-thumbnail");const url=URL.createObjectURL(file);previewUrls.push(url);img.src=url;img.alt="Aperçu de "+file.name;img.addEventListener("error",()=>{img.replaceWith(icon);});row.append(img);
 }else row.append(icon);
 const info=el("span","file-info");info.append(el("strong","",file.name),el("small","",sizeText(file.size)+(ext==="heic" || ext==="heif"?" · photo iPhone bien jointe, aperçu impossible dans le navigateur":"")));row.append(info);
 row.append(button("Retirer","file-remove",()=>{files.get(doc.key).splice(index,1);submissionId=newSubmissionId();drafts?.queue();refreshDocuments();document.querySelector("#upload-"+doc.key)?.focus();}));
 list.append(row);
 });
 for(const missing of draftMissing.filter(item=>item.key===doc.key)){
 const row=el("li","file-row missing-file");row.append(el("span","file-info","À ajouter de nouveau : "+missing.name+" — fichier non conservé."));
 row.append(button("Retirer cette référence","file-remove",()=>{draftMissing=draftMissing.filter(item=>item!==missing);drafts?.queue();refreshDocuments();}));list.append(row);
 }
 article.append(list);
 const uploadLabel=el("label","add-document upload-label","Ajouter votre document");
 uploadLabel.htmlFor="upload-"+doc.key;
 const input=el("input","file-input");input.id=uploadLabel.htmlFor;input.type="file";input.accept=accept;input.multiple=true;
 input.setAttribute("aria-label","Ajouter un ou plusieurs fichiers : "+doc.label);
 const uploadError=el("p","field-error");uploadError.setAttribute("role","alert");uploadError.hidden=true;
 // Même traitement pour la pellicule et pour « Prendre en photo ». Pas de DataTransfer : Safari iOS le refuse souvent,
 // et la photo resterait alors invisible dans le dossier.
 const ingestFiles=list=>{
 const incoming=[...list];
 if(!incoming.length)return;
 const max=serverConfig?.limits||limits;let error="";
 for(const file of incoming){
 if(!acceptedExtensions.includes(file.name.split(".").pop().toLowerCase()))error="Format non accepté : "+file.name;
 if(file.size===0)error="Ce fichier est vide : "+file.name;
 if(file.size>max.fileBytes)error="Chaque fichier doit faire au maximum "+sizeText(max.fileBytes)+".";
 if(/[\\/\r\n\u0000-\u001f]/.test(file.name))error="Ce nom de fichier contient un caractère non accepté.";
 }
 if(totalSize()+incoming.reduce((n,f)=>n+f.size,0)>max.totalBytes)error="L’ensemble des pièces dépasse "+sizeText(max.totalBytes)+". Retirez les doublons ou utilisez des fichiers moins lourds.";
 if(totalCount()+incoming.length>max.fileCount)error="Vous pouvez envoyer au maximum "+max.fileCount+" fichiers.";
 if(error){uploadError.textContent=error;uploadError.hidden=false;return;}
 files.set(doc.key,[...(files.get(doc.key)||[]),...incoming]);
 draftMissing=draftMissing.filter(item=>item.key!==doc.key || !incoming.some(file=>file.name===item.name));setDeferred(doc.key,false);refreshDocuments();document.querySelector("#upload-"+doc.key)?.focus();
 };
 input.addEventListener("change",()=>{ingestFiles(input.files);input.value="";});
 // Sur téléphone : prendre la pièce en photo tout de suite (appareil arrière), en plus du choix d'un fichier.
 const shotLabel=el("label","add-document upload-label shot-label","Prendre en photo");
 shotLabel.htmlFor="shot-"+doc.key;
 const shot=el("input","file-input");shot.id=shotLabel.htmlFor;shot.type="file";shot.accept="image/*";shot.setAttribute("capture","environment");shot.setAttribute("aria-label","Prendre en photo : "+doc.label);
 shot.addEventListener("change",()=>{ingestFiles(shot.files);shot.value="";});
 const uploadRow=el("div","upload-row");uploadRow.append(uploadLabel,input,shotLabel,shot);
 article.append(uploadRow,el("p","validation-hint upload-hint","Photographiez la pièce maintenant : à plat, bien cadrée, sans flash ni reflet. Un PDF fait aussi l’affaire."),uploadError);
 if(doc.deferrable && !(files.get(doc.key)||[]).length){
 const defer=el("label","consent defer-choice"),box=el("input");box.type="checkbox";box.id="defer-"+doc.key;box.checked=deferred;
 defer.append(box,document.createTextNode("Je n’ai pas ce document sous la main : AEM me recontactera pour le récupérer."));
 box.addEventListener("change",()=>{
 setDeferred(doc.key,box.checked);article.classList.toggle("deferred",box.checked);
 status.textContent=box.checked?"Non fournie — AEM vous recontactera":"Aucun fichier sélectionné";
 const requiredError=document.querySelector("#documents-required-error");if(requiredError && box.checked && !stepMissingFiles().length)requiredError.hidden=true;
 updateNext();
 });
 article.append(defer);
 }
 host.append(article);
 }
 host.append(el("p","validation-hint","PDF, JPG, JPEG, PNG, HEIC, HEIF, WEBP. Plusieurs fichiers possibles. Selon votre appareil : appareil photo, galerie ou documents. Les fichiers gardent leur nom et leur qualité d’origine."));
 const requiredError=el("p","field-error");requiredError.id="documents-required-error";requiredError.hidden=true;requiredError.setAttribute("role","alert");host.append(requiredError);
 updateNext();
 host.append(el("p","validation-hint",sizeText(totalSize())+" sélectionnés au total. Limite d’envoi : "+sizeText((serverConfig?.limits||limits).totalBytes)+"."));
}
function fileMetadata(){return [...files.entries()].flatMap(([key,list])=>list.map(file=>({key,name:file.name})));}
function stepMissingFiles(){return missingRequiredDocuments(answers,fileMetadata()).filter(d=>d.group===activeStep()?.documentGroup);}
function stepIsValid(){return (activeStep()?.fields||[]).every(f=>!fieldError(f,answers[f.key])) && !stepMissingFiles().length;}
function updateNext(){
 const ready=stepIsValid();const b=document.querySelector("#next-button");if(b)b.disabled=!ready||busy;
 const signal=document.querySelector("#step-signal");if(signal){signal.dataset.ready=String(ready);signal.querySelector(".signal-label").textContent=ready?"Vous pouvez continuer":"Réponse à compléter";}
}
function updateProgress(){
 const journey=document.querySelector(".journey");
 if(current==="welcome"){journey?.classList.add("journey-hidden");return;}
 journey?.classList.remove("journey-hidden");
 const steps=pathSteps(),index=steps.findIndex(s=>s.id===current),p=completed?100:Math.max(0,Math.round(index/(steps.length-1)*100));
 document.querySelector("#progress-label").textContent=completed?"Terminé":"Étape "+(index+1)+" sur "+steps.length;
 document.querySelector("#progress-group").textContent=completed?"Transmission terminée":activeStep()?.group||"";
 document.querySelector("#journey-title").textContent=workflows[answers.workflow]||"Votre démarche AEM";
 document.querySelector("#progress-bar").style.width=p+"%";
 const road=document.querySelector("#road");road.style.setProperty("--progress",p/100);
 road.setAttribute("aria-valuenow",p);
 const car=document.querySelector("#progress-car");if(car){const maxTravel=Math.max(0,road.clientWidth-car.getBoundingClientRect().width);car.style.left=(maxTravel*p/100)+"px";}
 if(car && p>lastMilestone && p>=25 && lastMilestone<25){lastMilestone=25;milestone();car.classList.add("car-bounce");setTimeout(()=>car.classList.remove("car-bounce"),600);}
 else if(car && p>lastMilestone && p>=50 && lastMilestone<50){lastMilestone=50;milestone();car.classList.add("car-bounce");setTimeout(()=>car.classList.remove("car-bounce"),600);}
 else if(car && p>lastMilestone && p>=75 && lastMilestone<75){lastMilestone=75;milestone();car.classList.add("car-bounce");setTimeout(()=>car.classList.remove("car-bounce"),600);}
}
let progressResizeFrame=0;
 window.addEventListener("resize",()=>{if(progressResizeFrame)return;progressResizeFrame=requestAnimationFrame(()=>{progressResizeFrame=0;updateProgress();});},{passive:true});
 function milestone(){document.dispatchEvent(new CustomEvent("aem:milestone"));}
function celebrate(message){
 if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
 const layer=el("div","celebrate-layer");
 layer.append(el("p","celebrate-text",message));
 for(let i=0;i<18;i++){
 const p=el("i","confetti");p.style.setProperty("--x",(Math.random()*100).toFixed(1)+"%");p.style.setProperty("--delay",(Math.random()*0.4).toFixed(2)+"s");p.style.setProperty("--hue",Math.floor(Math.random()*360));layer.append(p);
 }
 card.append(layer);setTimeout(()=>layer.remove(),1400);
}
function go(id,direction="forward"){
 if(busy||sending||drafts?.blocked)return;busy=true;card.dataset.direction=direction;card.classList.add("is-leaving");
 window.setTimeout(()=>{
  current=id;busy=false;pruneFiles();render();drafts?.queue();
  const prefer=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target=card.querySelector(".step-content, .summary-content")||card;
  target.scrollIntoView({block:"nearest",behavior:prefer?"auto":"smooth"});
 },matchMedia("(prefers-reduced-motion: reduce)").matches?0:190);
}
function showStepErrors(){
 let firstInvalid;
 for(const f of activeStep()?.fields||[]){
 const message=fieldError(f,answers[f.key]),error=document.getElementById(f.key+"-error");
 if(!error)continue;
 error.textContent=message;error.hidden=!message;
 const controls=error.closest(".field-block").querySelectorAll("input,select,textarea");
 controls.forEach(input=>input.setAttribute("aria-invalid",String(Boolean(message))));
 if(message && !firstInvalid)firstInvalid=controls[0];
 }
 const missing=stepMissingFiles(),requiredError=document.querySelector("#documents-required-error");
 if(requiredError){requiredError.textContent=missing.length?"Ajoutez le document demandé pour continuer.":"";requiredError.hidden=!missing.length;}
 if(!firstInvalid && missing.length)firstInvalid=document.getElementById("upload-"+missing[0].key);
 firstInvalid?.focus();
}
function navigateNext(){
 if(current==="welcome"){go("identity");return;}
 if(!stepIsValid()){showStepErrors();return;}
 const steps=pathSteps(),index=steps.findIndex(s=>s.id===current);
 if(editMode){const errors=answerErrors(cleanAnswers(answers));if(!errors.length && !missingRequiredDocuments(answers,fileMetadata()).length){editMode=false;go("summary");return;}}
 go(steps[index+1].id);
}
function renderWelcome(container){
 const info=welcomeInfo[workflow]||welcomeInfo.ants;
 container.append(el("span","eyebrow","Avant de commencer"));
 const h=el("h1","",info.title);h.tabIndex=-1;container.append(h);
 container.append(el("p","lead",info.why));
 const list=el("ul","welcome-checklist");
 info.docs.forEach(text=>list.append(el("li","",text)));
 container.append(el("p","field-label","Préparez ces éléments (photos ou PDF) :"),list);
 container.append(el("p","validation-hint","Vous pouvez remplir ce dossier en plusieurs fois : les réponses et fichiers sont sauvegardés automatiquement sur cet appareil pendant 7 jours. Rouvrez le même lien pour reprendre exactement où vous vous êtes arrêté."));
 const nav=el("nav","navigation");nav.setAttribute("aria-label","Démarrer le questionnaire");
 nav.append(el("span"));
 nav.append(button("Commencer mon dossier","next-button",navigateNext));
 container.append(nav);
}
function render(){
 if(drafts?.gate())return;
 releasePreviews();card.classList.remove("is-leaving");card.replaceChildren();
 if(current==="welcome"){const container=el("div","step-content welcome-content");card.append(container);renderWelcome(container);updateProgress();container.querySelector("h1").focus({preventScroll:true});return;}
 const s=activeStep();if(!s){current="welcome";return render();}
 const container=el("div",s.id==="summary"?"summary-content":"step-content");card.append(container);
 title(s,container);
 if(s.id==="summary"){renderSummary(container);updateProgress();container.querySelector("h1").focus({preventScroll:true});return;}
 for(const f of s.fields)container.append(fieldNode(f));
 if(s.documentGroup){const host=el("div","document-list");host.id="document-list";container.append(host);refreshDocuments();}
 const signal=el("p","step-signal");signal.id="step-signal";
 const lamps=el("span","signal-lamps");lamps.setAttribute("aria-hidden","true");lamps.append(el("i","stop-lamp"),el("i","go-lamp"));
 signal.append(lamps,el("span","signal-label"));container.append(signal);
 const nav=el("nav","navigation");nav.setAttribute("aria-label","Navigation du questionnaire");
 const steps=pathSteps(),index=steps.findIndex(x=>x.id===current);
 const back=button("","back-button",()=>go(index===0?"welcome":steps[index-1].id,"back"));back.append(labelWithIcon("arrowLeft","Retour",18));
 const next=button(editMode?"Enregistrer et continuer":"Continuer","next-button",navigateNext);next.id="next-button";
 nav.append(back,next);container.append(nav);updateNext();updateProgress();container.querySelector("h1").focus({preventScroll:true});
}
function renderSummary(container){
 container.querySelector(".lead").textContent="Relisez vos réponses et vos fichiers avant l’envoi. Vous pouvez encore les modifier.";
 const panel=el("div","summary-panel");
 for(const s of stepsFor(answers).filter(s=>s.id!=="summary")){
 const section=el("section","summary-group");section.append(el("h2","",s.title));
 for(const f of s.fields){const row=el("div","summary-row");row.append(el("span","",f.label),el("b","",displayValue(f,answers[f.key])+(f.type==="birthdate" && ageFromDate(answers.birthDate)!==null?" ("+ageFromDate(answers.birthDate)+" ans)":"")));section.append(row);}
 if(s.hint && !s.fields.length && !s.documentGroup)section.append(el("p","validation-hint",s.hint));
 if(s.documentGroup)for(const d of documentsFor(answers).filter(d=>d.group===s.documentGroup)){
 const selected=files.get(d.key)||[];section.append(el("p","summary-files",d.label+" : "+(selected.length?selected.map(f=>f.name).join(", "):d.deferrable && isDeferred(answers,d.key)?"Non fournie — AEM vous recontactera":"Aucun fichier sélectionné")));
 }
 section.append(button("Modifier","edit-button",()=>{editMode=true;go(s.id,"back");}));panel.append(section);
 }
 if(draftMissing.length)panel.append(el("p","field-error","Fichiers non restaurés, à ajouter de nouveau : "+draftMissing.map(item=>item.name).join(", ")+". Ils ne seront pas envoyés tant qu’ils n’auront pas été joints."));
 container.append(panel);
 const consent=el("label","consent");const checkbox=el("input");checkbox.type="checkbox";checkbox.id="send-confirm";
 const policy=el("a","","politique de confidentialité");policy.href="./confidentialite.html";policy.target="_blank";policy.rel="noopener";
 const purpose=workflow==="ants"?"pour traiter ma démarche ANTS":"pour traiter ma démarche permis";
 consent.append(checkbox,document.createTextNode("J’ai relu mes réponses. J’accepte qu’AEM conserve mes informations et documents (y compris un éventuel avis médical) "+purpose+". Voir la "),policy,document.createTextNode("."));container.append(consent);
 const err=el("p","field-error");err.id="send-error";err.setAttribute("role","alert");err.hidden=true;container.append(err);
 const send=button("Envoyer à AEM","next-button send-button",submit);send.id="send-button";send.disabled=true;
 checkbox.addEventListener("change",()=>{send.disabled=!checkbox.checked||sending||!serverConfig?.enabled;});container.append(send);
 const availability=el("p","validation-hint");availability.id="send-availability";container.append(availability);updateSendAvailability();
}
async function submit(){
 if(sending || completed || !document.querySelector("#send-confirm")?.checked)return;
 const clean=cleanAnswers(answers),errors=answerErrors(clean),error=document.querySelector("#send-error");
 if(errors.length){error.textContent=errors[0].message;error.hidden=false;return;}
 const missing=missingRequiredDocuments(clean,fileMetadata());
 if(missing.length){error.textContent="Ajoutez les fichiers nécessaires : "+missing.map(d=>d.label).join(", ")+". Modifiez la rubrique correspondante.";error.hidden=false;return;}
 sending=true;card.setAttribute("aria-busy","true");card.querySelectorAll("button,input").forEach(b=>b.disabled=true);
 drafts?.queue();await drafts?.flush();
 const send=document.querySelector("#send-button");
 if(drafts?.submissionError){
  error.textContent="Envoi interrompu : "+drafts.submissionError.message;error.hidden=false;
  sending=false;card.setAttribute("aria-busy","false");card.querySelectorAll("button,input").forEach(b=>b.disabled=false);
  send.textContent="Réessayer l’envoi";return;
 }
 send.textContent="Envoi en cours…";
 const data=new FormData(),metadata=[];let index=0;
 for(const doc of documentsFor(clean))for(const file of files.get(doc.key)||[]){
 const field="file_"+index++;metadata.push({field,key:doc.key,name:file.name,size:file.size});data.append(field,file,file.name);
 }
 data.append("payload",JSON.stringify({submissionId,answers:clean,files:metadata}));
 data.append("website",""); // Honeypot also checked server-side.
 const controller=new AbortController();const timeout=window.setTimeout(()=>controller.abort(),150000);
 try{
 const response=await fetch("./api/submit",{method:"POST",body:data,signal:controller.signal,headers:{"X-AEM-Request":"questionnaire",...drafts?.tokenHeader?.()}});
 const result=await response.json().catch(()=>null);
 if(!response.ok || !result?.ok || result.submissionId!==submissionId)throw new Error(result?.error||"L’envoi n’a pas été confirmé. Tu peux reprendre ton brouillon si sa sauvegarde est confirmée ci-dessus, puis réessayer.");
 if(serverConfig?.demo && result.demo){
 const destination=new URL(result.redirect,location.href);
 if(destination.origin!==location.origin || !destination.pathname.includes("/test-audit/"))throw new Error("Adresse de démonstration invalide.");
 completed=true;const cleared=await drafts.confirmed(submissionId);files.clear();draftMissing=[];releasePreviews();
 if(cleared){location.assign(destination.href);return;}
 card.replaceChildren();const done=el("div","summary-content");done.append(el("h1","","Dossier de test envoyé"));const audit=el("a","next-button","Voir l’audit de test");audit.href=destination.href;done.append(audit);card.append(done);return;
 }
 const deferred=deferredDocuments(clean,fileMetadata()); // avant files.clear() : les fichiers présents annulent le report
 completed=true;await drafts.confirmed(submissionId);files.clear();draftMissing=[];releasePreviews();card.replaceChildren();
 const done=el("div","summary-content");const badge=el("div","success-badge");badge.append(icon("check",28));done.append(badge);
 const h=el("h1","","Votre envoi a été pris en charge");h.tabIndex=-1;done.append(h);
 done.append(el("p","lead","Votre dossier a été enregistré par AEM. L’administration vérifiera vos documents et vous recontactera si nécessaire."));
 done.append(el("p","validation-hint","Référence : "+result.submissionId));
 if(deferred.length)done.append(el("p","validation-hint","AEM vous recontactera pour récupérer : "+deferred.map(d=>d.label).join(", ")+"."));
 celebrate("Dossier transmis !");
 done.append(button("Terminer et effacer mes réponses","secondary-button",()=>{resetQuestionnaire();drafts.fresh();render();}));
 card.append(done);updateProgress();h.focus();
 }catch(e){
 drafts?.queue();
 error.textContent=e.name==="AbortError"?"Le délai de confirmation est dépassé. Si ton brouillon est enregistré, tu peux le reprendre : une nouvelle tentative vérifiera la même référence avant tout nouvel envoi.":e.message;error.hidden=false;card.querySelectorAll("button,input").forEach(b=>b.disabled=false);send.textContent="Réessayer l’envoi";
 }finally{window.clearTimeout(timeout);sending=false;card.setAttribute("aria-busy","false");}
}
document.addEventListener("keydown",event=>{
 if(event.defaultPrevented || event.key!=="Enter" || event.repeat || event.isComposing || busy || sending || current==="summary" || current==="welcome")return;
 const target=event.target;
 if(!card.contains(target))return;
 if(target.dataset.calendar)return;
 if(target.tagName!=="INPUT" || !["text","email","tel","date","month","radio"].includes(target.type))return;
 event.preventDefault();navigateNext();
});

function updateSendAvailability(){
 const send=document.querySelector("#send-button"),note=document.querySelector("#send-availability");
 if(send)send.disabled=sending || !document.querySelector("#send-confirm")?.checked || !serverConfig?.enabled;
 if(note)note.textContent=serverConfig?.demo?"Démonstration locale : Envoyer ouvrira l’aperçu administratif. Aucun email ne sera envoyé.":serverConfig?.enabled?"":"L’envoi est indisponible sur cette version. Vous pouvez tester le questionnaire, mais aucun audit ni document ne sera envoyé à AEM.";
}
fetch("./api/config").then(r=>r.ok?r.json():null).then(config=>{if(config?.limits)serverConfig=config;updateSendAvailability();}).catch(()=>{updateSendAvailability();});
// Pont pour l'assistant de saisie (assist.js) : catalogue des champs, remplissage vérifié, état et avancée.
window.aemForm={
 catalog:()=>pathSteps().filter(s=>s.id!=="summary").map(s=>({id:s.id,title:s.title,group:s.group,documents:Boolean(s.documentGroup),fields:s.fields.map(f=>({key:f.key,label:f.label,type:f.type,required:f.required!==false,options:f.type==="choice"?f.options.map(o=>[o[0],o[1]]):undefined}))})),
 answers:()=>{const out={};for(const s of pathSteps())for(const f of s.fields)if(answers[f.key]!==undefined && answers[f.key]!=="")out[f.key]=answers[f.key];return out;},
 apply(values){
 const applied=[],ignored=[];
 if(sending || completed || drafts?.blocked)return {applied,ignored:Object.keys(values||{})};
 const allFields=pathSteps().flatMap(s=>s.fields);
 // Les choix d'abord : un changement de choix efface les champs qui en dépendent (par exemple la date d'expiration).
 const entries=Object.entries(values||{}).sort(([a],[b])=>(allFields.find(f=>f.key===b)?.type==='choice')-(allFields.find(f=>f.key===a)?.type==='choice'));
 for(const [key,raw] of entries){
 const field=pathSteps().flatMap(s=>s.fields).find(f=>f.key===key);
 if(!field){ignored.push(key);continue;}
 const value=String(raw??"").trim();
 if(!value || (field.type==="choice" && !field.options.some(o=>o[0]===value)) || fieldError(field,value)){ignored.push(key);continue;}
 if(answers[key]!==value){changed(key,value);}
 applied.push(key);
 }
 if(applied.length && current!=="welcome" && !busy)render();
 return {applied,ignored};
 },
 state(){
 if(drafts?.blocked)return {id:"resume",title:"Brouillon",ready:false,documents:false,missing:[],optional:[]};
 if(current==="welcome")return {id:"welcome",title:"Accueil",ready:true,documents:false,missing:[],optional:[]};
 const s=activeStep();if(!s)return {id:current,title:"",ready:false,documents:false,missing:[],optional:[]};
 return {id:s.id,title:s.title,ready:stepIsValid(),documents:Boolean(s.documentGroup),missing:s.fields.filter(f=>fieldError(f,answers[f.key])).map(f=>f.key),optional:s.fields.filter(f=>!f.required && !String(answers[f.key]??"").trim()).map(f=>f.key)};
 },
 next(){if(!busy && !sending)navigateNext();}
};
function resetQuestionnaire(){
 releasePreviews();answers={workflow};files=new Map();draftMissing=[];completed=false;sending=false;busy=false;
 current="welcome";submissionId=newSubmissionId();draftId=newSubmissionId();editMode=false;lastMilestone=0;
 document.dispatchEvent(new CustomEvent("aem:reset"));
}
drafts=createDraftSession({
 workflow,card,
 snapshot:()=>({answers,files,missing:draftMissing,step:current,submissionId,draftId,editMode,sending}),
 restore:({record,files:restoredFiles,missing})=>{
  answers={...record.answers,workflow};files=restoredFiles;draftMissing=missing;
  submissionId=/^[a-f0-9-]{36}$/i.test(record.submissionId)?record.submissionId:newSubmissionId();
  draftId=record.draftId;editMode=Boolean(record.editMode);pruneFiles();
  current=record.step==="welcome" || stepsFor(answers).some(step=>step.id===record.step)?record.step:"identity";
  document.dispatchEvent(new CustomEvent("aem:reset"));
 },
 reset:resetQuestionnaire,render
});
drafts.init();
