// Espace de gestion AEM : file de travail, fiche de dossier, relance, dépôt au comptoir, rôles (lecture / traitement / responsable).
const $=s=>document.querySelector(s);
const loginPanel=$("#admin-login"),adminPanel=$("#admin-panel"),loginForm=$("#login-form"),loginError=$("#login-error");
const dossierList=$("#dossier-list"),detailPanel=$("#detail-panel"),detailContent=$("#detail-content"),detailEmpty=$("#detail-empty"),detailError=$("#detail-error"),detailBack=$("#detail-back");
const listEmpty=$("#list-empty"),listEmptyText=listEmpty.textContent;
const statusFilter=$("#status-filter"),workflowFilter=$("#workflow-filter"),searchInput=$("#search-input"),filterNote=$("#filter-note");
const userLabel=$("#admin-user-label"),serviceSettings=$("#service-settings"),serviceStatus=$("#service-status"),queue=$("#admin-queue"),summaryLine=$("#admin-summary"),layout=$("#admin-layout");
const candidateMailLabels={sent:"envoyé",failed:"échec d’envoi",skipped:"non envoyé"};
const adminNotifyLabels={pending:"à envoyer",sending:"envoi en cours",sent:"envoyée",failed:"échec",uncertain:"résultat incertain",skipped:"non envoyée"};
const groupLabels={identity:"Identité",age:"Justificatifs liés à l’âge",home:"Domicile",europeResidence:"Situation Europe",permit:"Permis",special:"Compléments",medical:"Compléments"};
const queueMore=$("#admin-queue-more");
const refreshWarning="Modification enregistrée, mais l’affichage n’a pas pu être actualisé : ";
const ACCEPT=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf";
const STALE_DAYS=10,POLL_MS=60*1000;
const pendingDossierFromUrl=()=>{try{const id=new URLSearchParams(location.search).get("dossier");return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id||"")?id:null;}catch{return null;}};
// Libellés (statuts, historique, rôles) fournis par le serveur : source unique.
let statuses={},historyActions={},adminNotifyStates={},roles={},items=[],selectedId=null,listSeq=0,session={user:"",role:""},clientQueue="",lastReceived=null,pollTimer=0,pendingDossier=pendingDossierFromUrl();
const previews=new Set();

const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const fmtDate=value=>value?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"—";
const fmtDay=value=>value?new Intl.DateTimeFormat("fr-FR",{dateStyle:"long"}).format(new Date(value)):"—";
const showError=(node,message)=>{node.textContent=message;node.hidden=false;};
const canWrite=()=>session.role!=="lecture";
const ageFrom=birthDate=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate||""))return null;const b=new Date(birthDate),n=new Date();let age=n.getFullYear()-b.getFullYear();const m=n.getMonth()-b.getMonth();if(m<0 || (m===0 && n.getDate()<b.getDate()))age--;return age;};
const frDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||"")?v.split("-").reverse().join("/"):(v||"—");
const releasePreviews=()=>{for(const url of previews)URL.revokeObjectURL(url);previews.clear();};
let outboundDrag=false;
const FACE_OPTIONS=[["","À qualifier"],["recto","Recto"],["verso","Verso"],["both","Recto et verso"]];
const exportInfoFor=(dossier,file)=>{
 const list=dossier.exportFiles||[];
 return list.find(x=>x.index===file.index)||null;
};
const absoluteFileUrl=(dossierId,index,download=true)=>{
 const rel="./api/admin/dossiers/"+dossierId+"/files/"+index+(download?"?download=1":"");
 try{return new URL(rel,location.href).href;}catch{return rel;}
};
const revokeLater=(url,ms=120000)=>{if(!url||!String(url).startsWith("blob:"))return;setTimeout(()=>{try{URL.revokeObjectURL(url);}catch{}previews.delete(url);},ms);};

async function writeFilesToDirectory(dirHandle,folderName,filesPayload,{onConflict}={}){
 let target=dirHandle;
 let usedName=folderName;
 try{
  target=await dirHandle.getDirectoryHandle(folderName,{create:false});
  const choice=onConflict?await onConflict(folderName):"suffix";
  if(choice==="cancel")return {cancelled:true};
  if(choice==="suffix"){
   let n=2;
   while(true){
    usedName=folderName+" ("+n+")";
    try{await dirHandle.getDirectoryHandle(usedName,{create:false});n++;}
    catch{break;}
   }
   target=await dirHandle.getDirectoryHandle(usedName,{create:true});
  }else{
   // compléter sans écraser
   usedName=folderName;
  }
 }catch{
  target=await dirHandle.getDirectoryHandle(folderName,{create:true});
 }
 const written=[];
 const failed=[];
 for(const item of filesPayload){
  try{
   let name=item.exportName;
   try{
    await target.getFileHandle(name,{create:false});
    let n=2,stem=name.replace(/\.[^.]+$/,""),ext=(name.match(/(\.[^.]+)$/)||[])[1]||"";
    while(true){
     const candidate=stem+" ("+n+")"+ext;
     try{await target.getFileHandle(candidate,{create:false});n++;}
     catch{name=candidate;break;}
    }
   }catch{/* libre */}
   const fh=await target.getFileHandle(name,{create:true});
   const w=await fh.createWritable();
   await w.write(item.blob);
   await w.close();
   written.push(name);
  }catch(e){
   failed.push({name:item.exportName,error:e.message||"écriture impossible"});
  }
 }
 return {cancelled:false,folderName:usedName,written,failed};
}

// Les en-têtes passés par l'appelant complètent ceux par défaut ; un FormData part sans Content-Type JSON.
const api=async(path,options={})=>{
 const {headers:extra={},...rest}=options;
 const headers={"X-AEM-Admin":"1",...extra};
 if(!(rest.body instanceof FormData))headers["Content-Type"]="application/json";
 const response=await fetch("./api/admin/"+path,{credentials:"same-origin",...rest,headers});
 const data=await response.json().catch(()=>null);
 // Session expirée pendant l'utilisation : retour à l'écran de connexion (le 401 du formulaire de login est un mauvais mot de passe, pas une expiration).
 if(response.status===401 && !adminPanel.hidden && path!=="login")expireSession(data?.error||"Session expirée.");
 if(!response.ok)throw Object.assign(new Error(data?.error||"Requête impossible."),{status:response.status});
 return data;
};

/* ---------- Session ---------- */
function resetDetail(){
 selectedId=null;releasePreviews();detailContent.replaceChildren();detailContent.hidden=true;detailEmpty.hidden=false;detailError.hidden=true;detailPanel.hidden=true;
 layout.classList.remove("has-detail");document.title="Dossiers AEM";
 $("#admin-title").textContent="Dossiers";$("#admin-eyebrow").textContent="File de travail";
}
function leavePanel(){
 resetDetail();stopPolling();
 adminPanel.hidden=true;loginPanel.hidden=false;queue.hidden=true;if(queueMore)queueMore.hidden=true;serviceSettings.hidden=true;
 items=[];userLabel.textContent="";dossierList.replaceChildren();listEmpty.hidden=true;lastReceived=null;
 $("#admin-password").value="";
}
function expireSession(message){leavePanel();showError(loginError,message+" Reconnectez-vous.");}

async function ensureSession(){
 const data=await api("session",{method:"GET"});
 statuses=data.statuses||{};historyActions=data.historyActions||{};adminNotifyStates=data.adminNotifyStates||adminNotifyLabels;roles=data.roles||{};
 statusFilter.replaceChildren(
 Object.assign(el("option","","En cours de traitement"),{value:""}),
 ...Object.entries(statuses).filter(([v])=>v!=="archived").map(([value,label])=>Object.assign(el("option","",label),{value})),
 Object.assign(el("option","","Classés"),{value:"archived"}),
 Object.assign(el("option","","Tous, classés compris"),{value:"all"}));
 // Phase de test : identifiants préremplis par le serveur (AEM_ADMIN_PREFILL), avec une mention visible.
 if(data.prefill && !data.authenticated){$("#admin-user").value=data.prefill.user;$("#admin-password").value=data.prefill.password;const note=$("#login-prefill");if(note){note.hidden=false;}}
 if(data.authenticated)await showPanel({user:data.user,role:data.role});
}
async function showPanel(info){
 session={user:info.user||"admin",role:info.role||"traitement"};
 resetDetail();
 loginPanel.hidden=true;adminPanel.hidden=false;queue.hidden=false;if(queueMore)queueMore.hidden=false;
 userLabel.textContent=session.user+" · "+(roles[session.role]||session.role);
 serviceSettings.hidden=session.role!=="responsable";
 await Promise.all([loadStats(),session.role==="responsable"?loadStatus():Promise.resolve()]);
 applyQueue("received");
 startPolling();
 if(pendingDossier){
  const id=pendingDossier;pendingDossier=null;
  try{history.replaceState({},"",location.pathname+(location.hash||""));}catch{}
  await openDossier(id).catch(e=>{if(e?.status!==401)showError(detailError,e.message||"Dossier introuvable.");});
 }
}

/* ---------- File de travail ---------- */
async function loadStatus(){
 try{
 const s=await api("status");
 serviceStatus.textContent="Messagerie "+(s.mail?"activée":"non configurée")+" · accusé candidat "+(s.candidateMail?"activé":"désactivé")+" · assistant IA "+(s.ai?"activé":"désactivé")+" · conservation "+(s.retentionDays?s.retentionDays+" jours":"désactivée")+" · fichiers "+(s.blobDriver||"local")+" · "+s.accounts+" compte(s) · stockage "+s.dataDir+(s.chat?" · assistant du site : "+(s.chat.total??0)+" question(s)":"");
 }catch(e){serviceStatus.textContent="État du service indisponible : "+e.message;}
}
async function loadStats(){
 try{
 const s=await api("stats");
 for(const [id,key] of [["stat-received","received"],["stat-missing","missingPieces"],["stat-collect","toCollect"],["stat-progress","inProgress"],["stat-stale","stale"],["stat-unassigned","unassigned"]])$("#"+id).textContent=s[key]??0;
 summaryLine.textContent=(s.total??0)+" dossier(s) au total · "+(s.today??0)+" reçu(s) aujourd’hui";
 // Nouveau dossier arrivé depuis le dernier rafraîchissement : pastille jusqu'au clic sur « À traiter ».
 if(lastReceived!==null && (s.received??0)>lastReceived)$("#badge-received").hidden=false;
 lastReceived=s.received??0;
 }catch{for(const id of ["stat-received","stat-missing","stat-collect","stat-progress","stat-stale","stat-unassigned"])$("#"+id).textContent="—";}
}
function applyQueue(name){
 clientQueue="";$("#badge-received").hidden=name==="received"?true:$("#badge-received").hidden;
 if(name==="received" || name==="missing_pieces" || name==="in_progress"){statusFilter.value=name;}
 else{statusFilter.value="";clientQueue=name;}
 for(const card of document.querySelectorAll(".queue-card"))card.classList.toggle("active",card.dataset.queue===name);
 filterNote.hidden=false;
 filterNote.textContent={received:"Dossiers reçus, pas encore pris en charge.",missing_pieces:"Dossiers en attente de pièces demandées au candidat.",toCollect:"Dossiers où le candidat n’avait pas une pièce sous la main : AEM doit la récupérer.",in_progress:"Dossiers en cours de traitement.",stale:"Relancés il y a "+STALE_DAYS+" jours ou plus, toujours sans pièces.",unassigned:"Dossiers reçus que personne ne suit encore."}[name]||"";
 loadList().catch(showListError);
}
document.addEventListener("click",event=>{const card=event.target.closest(".queue-card");if(card)applyQueue(card.dataset.queue);});
function clearQueue(){clientQueue="";filterNote.hidden=true;for(const card of document.querySelectorAll(".queue-card"))card.classList.remove("active");}

async function loadList(){
 const params=new URLSearchParams();
 if(workflowFilter.value)params.set("workflow",workflowFilter.value);
 if(statusFilter.value)params.set("status",statusFilter.value);
 if(searchInput.value.trim())params.set("q",searchInput.value.trim());
 // Réponses hors ordre (recherche, filtres, Actualiser) : seule la dernière requête émise met à jour la liste.
 const seq=++listSeq;
 let data;
 try{data=await api("dossiers?"+params.toString());}catch(e){if(seq!==listSeq)return;throw e;}
 if(seq!==listSeq)return;
 items=(data.items||[]).filter(i=>clientQueue==="toCollect"?i.incomplete:clientQueue==="stale"?typeof i.staleDays==="number" && i.staleDays>=STALE_DAYS:clientQueue==="unassigned"?i.status==="received" && !i.assignedTo:true);
 dossierList.replaceChildren();
 listEmpty.textContent=listEmptyText;listEmpty.hidden=items.length>0;
 for(const item of items){
 const li=el("li");
 const button=el("button");button.type="button";
 button.append(el("span","dossier-avatar",((item.firstName||"?")[0]+(item.birthName||"?")[0]).toUpperCase()));
 button.append(el("span","dossier-name",(item.birthName||"").toUpperCase()+" "+(item.firstName||"")));
 button.append(el("span","dossier-meta",item.workflowLabel+" · "+fmtDate(item.createdAt)+(item.minor?" · mineur":"")));
 const chips=el("span","dossier-chips");
 const pill=el("span","admin-status",statuses[item.status]||item.status);pill.dataset.status=item.status;chips.append(pill);
 if(item.incomplete)chips.append(el("span","admin-status admin-status-flag","à récupérer"));
 if(typeof item.staleDays==="number")chips.append(el("span","admin-status"+(item.staleDays>=STALE_DAYS?" admin-status-warn":""),"relancé il y a "+item.staleDays+" j"));
 if(item.assignedTo)chips.append(el("span","admin-chip","Suivi par "+item.assignedTo));
 button.append(chips);
 button.classList.toggle("selected",item.id===selectedId);
 button.addEventListener("click",()=>openDossier(item.id));
 li.append(button);dossierList.append(li);
 }
 if(selectedId && !items.some(i=>i.id===selectedId))resetDetail();
}

// Rafraîchissement automatique : stats et liste toutes les 60 s quand l'onglet est visible ; la fiche ouverte n'est pas rechargée.
function startPolling(){stopPolling();pollTimer=setInterval(()=>{if(document.visibilityState==="visible")Promise.all([loadStats(),loadList()]).catch(()=>{});},POLL_MS);}
function stopPolling(){clearInterval(pollTimer);pollTimer=0;}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible" && !adminPanel.hidden)Promise.all([loadStats(),loadList()]).catch(()=>{});});

/* ---------- Fiche ---------- */
// Ne rejette jamais : un échec (réseau, 404, 500) s'affiche dans #detail-error ; un 401 a déjà ramené à l'écran de connexion via api().
async function openDossier(id,context=""){
 selectedId=id;detailError.hidden=true;
 try{
 await loadList();
 const {dossier,documents=[]}=await api("dossiers/"+id);
 renderDossier(dossier,documents);
 }catch(e){
 if(e.status===401)return;
 detailPanel.hidden=false;detailContent.hidden=true;detailEmpty.hidden=false;layout.classList.add("has-detail");
 showError(detailError,context+e.message);
 }
}
detailBack.addEventListener("click",()=>{layout.classList.remove("has-detail");detailPanel.hidden=true;});

function contactLine(label,phone,email){
 const row=el("div","admin-contact");
 row.append(el("strong","",label));
 if(phone){const a=el("a","","Appeler "+phone.replace(/(\d{2})(?=\d)/g,"$1 "));a.href="tel:"+phone.replace(/\s/g,"");row.append(a);}
 if(email){const a=el("a","","Écrire à "+email);a.href="mailto:"+email;row.append(a);}
 if(!phone && !email)row.append(el("span","","—"));
 return row;
}
function renderDossier(dossier,documents){
 const a=dossier.answers||{};
 releasePreviews();
 detailPanel.hidden=false;detailEmpty.hidden=true;detailContent.hidden=false;detailContent.replaceChildren();
 layout.classList.add("has-detail");detailBack.hidden=false;
 const name=(dossier.birthName||"").toUpperCase()+" "+(dossier.firstName||"");
 document.title=name+" · Dossiers AEM";$("#admin-title").textContent=name;$("#admin-eyebrow").textContent=dossier.workflowLabel||"Dossier";
 const head=el("div","admin-fiche-head");
 const titleBox=el("div");titleBox.append(el("p","eyebrow",dossier.workflowLabel||"Dossier"),el("h2","",name));
 const pill=el("span","admin-status admin-status-big",statuses[dossier.status]||dossier.status);pill.dataset.status=dossier.status;
 head.append(titleBox,pill);detailContent.append(head);
 const age=ageFrom(a.birthDate||dossier.birthDate);
 const deferred=documents.filter(d=>d.deferred && !d.fileCount);
 const summary=el("ul","admin-resume");
 summary.append(el("li","","Parcours : "+(dossier.workflowLabel||"—")));
 summary.append(el("li","","Âge : "+(age!==null?age+" ans":"à confirmer")));
 summary.append(el("li","","Téléphone : "+(dossier.phone||a.phone||"—")));
 summary.append(el("li","","E-mail : "+(dossier.email||a.email||"—")));
 summary.append(el("li","",deferred.length?"Pièces à récupérer : "+deferred.map(d=>d.label).join(", "):"Pièces à récupérer : aucune"));
 detailContent.append(summary);
 const meta=[ "Reçu le "+fmtDate(dossier.createdAt), "Réf. "+dossier.id.slice(0,8), "Accusé candidat : "+(candidateMailLabels[dossier.candidateMail]||"non envoyé")];
 if(dossier.adminNotify)meta.push("Notification admin : "+(adminNotifyStates[dossier.adminNotify]||adminNotifyLabels[dossier.adminNotify]||dossier.adminNotify));
 if(dossier.expiresAt)meta.push("Sera effacé le "+fmtDay(dossier.expiresAt));
 if(dossier.finalizedAt)meta.push("Finalisé le "+fmtDay(dossier.finalizedAt));
 detailContent.append(el("p","validation-hint",meta.join(" · ")));
 const contacts=el("div","admin-contacts");
 contacts.append(contactLine("Candidat"+(age!==null?" · "+age+" ans ("+frDate(a.birthDate||dossier.birthDate)+")":""),dossier.phone||a.phone,dossier.email||a.email));
 if(a.contactName)contacts.append(contactLine("Responsable : "+a.contactName,a.contactPhone,a.contactEmail));
 detailContent.append(contacts);
 detailContent.append(assignBlock(dossier));
 if(deferred.length){
 const notice=el("p","validation-hint");
 notice.append(el("span","admin-status admin-status-flag","à récupérer")," Le candidat n’avait pas : "+deferred.map(d=>d.label).join(", ")+". À récupérer par téléphone, e-mail ou au comptoir.");
 detailContent.append(notice);
 }
 if(canWrite())detailContent.append(quickActions(dossier));
 detailContent.append(el("h2","","Pièces"));
 detailContent.append(checklist(dossier,documents));
 const audit=el("details","admin-audit-box");audit.append(el("summary","","Audit détaillé"),el("pre","admin-audit",dossier.auditText||""));
 detailContent.append(audit);
 const tools=el("div","admin-tools");
 const print=el("a","next-button","Fiche à imprimer");print.href="./api/admin/dossiers/"+dossier.id+"/export";print.target="_blank";print.rel="noopener";tools.append(print);
 const zip=el("a","secondary-button","Télécharger le dossier ZIP");
 zip.href="./api/admin/dossiers/"+dossier.id+"/archive.zip";
 zip.setAttribute("download",(dossier.exportFolderName||"dossier")+".zip");
 tools.append(zip);
 const folderBtn=el("button","secondary-button","Créer le dossier sur mon ordinateur");
 folderBtn.type="button";
 const exportStatus=el("p","admin-export-status");exportStatus.hidden=true;exportStatus.setAttribute("role","status");
 const exportError=el("p","field-error");exportError.hidden=true;exportError.setAttribute("role","alert");
 folderBtn.addEventListener("click",async()=>{
  exportError.hidden=true;exportStatus.hidden=true;
  if(typeof window.showDirectoryPicker!=="function"){
   showError(exportError,"Votre navigateur ne permet pas de créer un dossier local directement. Utilisez « Télécharger le dossier ZIP », puis extrayez-le dans l’Explorateur.");
   return;
  }
  const files=dossier.files||[];
  if(!files.length){showError(exportError,"Aucun document à exporter pour ce dossier.");return;}
  let parent;
  try{parent=await window.showDirectoryPicker({mode:"readwrite"});}
  catch(e){
   if(e && (e.name==="AbortError" || e.name==="NotAllowedError")){exportStatus.hidden=false;exportStatus.textContent="Création annulée.";return;}
   showError(exportError,e.message||"Sélection du dossier impossible.");
   return;
  }
  folderBtn.disabled=true;
  exportStatus.hidden=false;exportStatus.textContent="Préparation des fichiers…";
  const payload=[];
  const prepFailed=[];
  for(const file of files){
   const exp=exportInfoFor(dossier,file);
   const exportName=exp?.exportName||file.displayName||file.name||("fichier-"+file.index);
   try{
    const r=await fetch("./api/admin/dossiers/"+dossier.id+"/files/"+file.index+"?download=1",{credentials:"same-origin"});
    if(!r.ok){prepFailed.push(exportName);continue;}
    payload.push({exportName,blob:await r.blob()});
   }catch{prepFailed.push(exportName);}
  }
  if(!payload.length){
   folderBtn.disabled=false;
   showError(exportError,"Aucun fichier n’a pu être lu depuis le serveur."+(prepFailed.length?" Échecs : "+prepFailed.join(", "):""));
   return;
  }
  const folderName=dossier.exportFolderName||"Dossier candidat";
  exportStatus.textContent="Écriture dans le dossier choisi…";
  try{
   const result=await writeFilesToDirectory(parent,folderName,payload,{
    onConflict:async name=>{
     const ok=window.confirm("Le dossier « "+name+" » existe déjà.\nOK = compléter sans écraser les fichiers homonymes.\nAnnuler = créer un dossier avec un suffixe (2), (3)…");
     return ok?"merge":"suffix";
    }
   });
   if(result.cancelled){exportStatus.textContent="Création annulée.";folderBtn.disabled=false;return;}
   const parts=["Dossier « "+result.folderName+" » : "+result.written.length+" document(s) enregistré(s)."];
   if(result.failed.length)parts.push("Échecs : "+result.failed.map(f=>f.name).join(", ")+".");
   if(prepFailed.length)parts.push("Non lus sur le serveur : "+prepFailed.join(", ")+".");
   if(result.failed.length || prepFailed.length){
    exportStatus.textContent="Export partiel — "+parts.join(" ");
   }else{
    exportStatus.textContent="Export terminé — "+parts.join(" ");
   }
  }catch(e){
   showError(exportError,e.message||"Écriture locale impossible.");
  }
  folderBtn.disabled=false;
 });
 tools.append(folderBtn);
 detailContent.append(tools,exportStatus,exportError);
 const tip=el("p","validation-hint admin-export-tip");
 tip.textContent="Glisser-déposer vers Windows : utilisez la poignée ⋮⋮ à gauche de chaque document (Chrome/Edge). Cela copie le fichier ; le dossier AEM n’est jamais modifié. Si le geste n’est pas pris en charge, utilisez Télécharger ou le ZIP.";
 detailContent.append(tip);
 if(canWrite()){
 detailContent.append(actionsBlock(dossier));
 const notify=notifyBlock(dossier);if(notify)detailContent.append(notify);
 detailContent.append(requestBlock(dossier,documents));
 detailContent.append(mailBlock(dossier));
 detailContent.append(deleteBlock(dossier));
 }else detailContent.append(el("p","validation-hint admin-readonly","Compte en lecture seule : statut, note, relance, ajout de pièce et suppression sont réservés aux comptes de traitement."));
 detailContent.append(el("h2","","Historique"));
 const history=el("ul","admin-history");
 for(const entry of [...(dossier.history||[])].reverse()){
 const li=el("li");
 li.append(el("strong","",fmtDate(entry.at)+" · "+(entry.by||"système")+" · "+(historyActions[entry.action]||entry.action)),document.createElement("br"),document.createTextNode(entry.details||""));
 history.append(li);
 }
 if(!history.children.length)history.append(el("li","","Aucune entrée."));
 detailContent.append(history);
 if(window.innerWidth<900)detailPanel.scrollIntoView({block:"start"});
}

function quickActions(dossier){
 const wrap=el("div","admin-quick");
 wrap.append(el("p","field-label","Actions rapides"));
 const row=el("div","admin-quick-row");
 const phone=(dossier.phone||dossier.answers?.phone||"").replace(/\s/g,"");
 if(phone){const call=el("a","next-button","Appeler");call.href="tel:"+phone;row.append(call);}
 const setStatus=async(status,btn)=>{btn.disabled=true;try{await api("dossiers/"+dossier.id,{method:"PATCH",body:JSON.stringify({status})});await loadStats();await openDossier(dossier.id,refreshWarning);}catch(e){btn.disabled=false;alert(e.message);}};
 for(const [status,label] of [["in_progress","En cours"],["ready","Prêt"],["archived","Classé"]]){
  if(dossier.status===status)continue;
  const b=el("button","secondary-button",label);b.type="button";b.addEventListener("click",()=>setStatus(status,b));row.append(b);
 }
 const ask=el("button","secondary-button","Demander une pièce");ask.type="button";ask.addEventListener("click",()=>document.querySelector(".admin-request")?.scrollIntoView({block:"start",behavior:"smooth"}));
 row.append(ask);
 wrap.append(row);
 return wrap;
}

// « Suivi par » : moi, ou un prénom saisi ; vide pour retirer.
function assignBlock(dossier){
 const block=el("div","admin-assign");
 const label=el("label","field-label","Suivi par");label.htmlFor="assign-input";
 const input=el("input","text-input");input.id="assign-input";input.maxLength=64;input.value=dossier.assignedTo||"";input.placeholder="Personne";input.disabled=!canWrite();
 const me=el("button","secondary-button","Moi");me.type="button";me.disabled=!canWrite();
 const save=el("button","edit-button","Enregistrer");save.type="button";save.disabled=!canWrite();
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 const send=async value=>{save.disabled=true;me.disabled=true;error.hidden=true;
 try{await api("dossiers/"+dossier.id,{method:"PATCH",body:JSON.stringify({assignedTo:value})});}
 catch(e){showError(error,e.message);save.disabled=false;me.disabled=false;return;}
 await loadStats();await openDossier(dossier.id,refreshWarning);};
 me.addEventListener("click",()=>send("me"));
 save.addEventListener("click",()=>send(input.value.trim()));
 input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();send(input.value.trim());}});
 block.append(label,input,me,save,error);
 return block;
}

// Checklist des pièces, groupée ; aperçu des images ; ajout d'une pièce reçue au comptoir.
function checklist(dossier,documents){
 const wrap=el("div","admin-checklist");
 const groups=new Map();
 for(const doc of documents){const g=groupLabels[doc.group]||"Autres pièces";if(!groups.has(g))groups.set(g,[]);groups.get(g).push(doc);}
 if(!documents.length)wrap.append(el("p","validation-hint","Aucune pièce attendue pour ce dossier."));
 for(const [group,docs] of groups){
 wrap.append(el("h3","",group));
 for(const doc of docs){
 const row=el("div","admin-piece");
 const state=doc.fileCount?["reçue","ok",doc.fileCount+" fichier(s)"]:doc.deferred?["à récupérer","flag","le candidat ne l’avait pas"]:["manquante","missing","aucun fichier"];
 const head=el("div","admin-piece-head");
 const pill=el("span","admin-status admin-piece-state",state[0]);pill.dataset.state=state[1];
 head.append(el("strong","",doc.label),pill,el("small","",state[2]));row.append(head);
 const files=(dossier.files||[]).filter(f=>f.key===doc.key);
 if(files.length){
 const list=el("ul","admin-files");
 for(const file of files){
 const li=el("li");
 const exp=exportInfoFor(dossier,file);
 const exportName=exp?.exportName||file.displayName||file.name||"document";
 const href="./api/admin/dossiers/"+dossier.id+"/files/"+file.index;
 if(/^image\//.test(file.contentType) && !/hei[cf]/.test(file.contentType)){
 const thumb=el("a","admin-thumb");thumb.href=href;thumb.target="_blank";thumb.rel="noopener";
 const img=el("img");img.alt="Aperçu de "+(file.displayName||file.name);thumb.append(img);li.append(thumb);
 fetch(href,{credentials:"same-origin"}).then(r=>r.ok?r.blob():null).then(b=>{if(b){const url=URL.createObjectURL(b);previews.add(url);img.src=url;}}).catch(()=>{});
 }
 const handle=el("span","admin-drag-handle");
 handle.draggable=true;
 handle.title="Glisser vers l’Explorateur Windows (copie)";
 handle.setAttribute("aria-label","Glisser "+exportName+" vers un dossier Windows");
 handle.textContent="⋮⋮";
 let prefetchBlob=null,prefetchUrl="";
 handle.addEventListener("pointerdown",()=>{
  prefetchBlob=null;prefetchUrl="";
  fetch(href+"?download=1",{credentials:"same-origin"}).then(r=>r.ok?r.blob():null).then(b=>{
   if(!b)return;
   prefetchBlob=b;
   prefetchUrl=URL.createObjectURL(b);
   previews.add(prefetchUrl);
  }).catch(()=>{});
 });
 handle.addEventListener("dragstart",e=>{
  outboundDrag=true;
  e.stopPropagation();
  try{e.dataTransfer.effectAllowed="copy";}catch{}
  const mime=file.contentType||"application/octet-stream";
  const safeName=String(exportName).replace(/:/g,"-");
  const abs=absoluteFileUrl(dossier.id,file.index,true);
  const urlForDrag=prefetchUrl||abs;
  // DownloadURL Chromium/Edge : un seul enregistrement (blob préchargé si prêt, sinon URL Admin same-origin).
  try{e.dataTransfer.setData("DownloadURL",mime+":"+safeName+":"+urlForDrag);}catch{}
  try{e.dataTransfer.setData("text/plain",safeName);}catch{}
  if(prefetchUrl)revokeLater(prefetchUrl,180000);
  handle.classList.add("is-dragging");
 });
 handle.addEventListener("dragend",()=>{outboundDrag=false;handle.classList.remove("is-dragging");});
 const info=el("span","admin-file-info");
 info.append(el("strong","",file.displayName||file.name));
 info.append(el("small","","Export : "+exportName));
 if(exp?.needsFace && !exp.face)info.append(el("small","admin-face-warn","Face à qualifier (recto / verso / les deux) avant un code CI1/CI2/CI0."));
 info.append(el("small","",(file.originalName && file.originalName!==(file.displayName||file.name)?"fichier reçu : "+file.originalName+" · ":"")+file.contentType+" · "+Math.round(file.size/1024)+" Ko"+(file.source==="comptoir"?" · ajouté au comptoir"+(file.addedBy?" par "+file.addedBy:""):"")));
 const links=el("span","admin-file-actions");
 const open=el("a","","Ouvrir");open.href=href;open.target="_blank";open.rel="noopener";
 const download=el("a","","Télécharger");download.href=href+"?download=1";download.setAttribute("download",exportName);
 links.append(open," · ",download);
 if(canWrite()){
  const rename=el("button","admin-link-button","Renommer");rename.type="button";
  rename.addEventListener("click",async()=>{
   const current=file.displayName||file.name||"";
   const next=window.prompt("Nom d’affichage du document",current);
   if(next===null)return;
   const wanted=String(next).trim();
   if(!wanted || wanted===current)return;
   rename.disabled=true;
   try{await api("dossiers/"+dossier.id+"/files/"+file.index,{method:"PATCH",body:JSON.stringify({displayName:wanted})});}
   catch(e){window.alert(e.message||"Renommage impossible.");rename.disabled=false;return;}
   await loadStats();await openDossier(dossier.id,refreshWarning);
  });
  links.append(" · ",rename);
 }
 if(canWrite() && exp?.needsFace){
  const faceLabel=el("label","admin-face-label","Face");
  const faceSel=el("select","admin-face-select");
  faceSel.setAttribute("aria-label","Qualification recto/verso pour "+(file.displayName||file.name));
  for(const [value,label] of FACE_OPTIONS){
   const opt=el("option","",label);opt.value=value;if((file.face||"")===value)opt.selected=true;faceSel.append(opt);
  }
  faceSel.addEventListener("change",async()=>{
   faceSel.disabled=true;
   try{await api("dossiers/"+dossier.id+"/files/"+file.index,{method:"PATCH",body:JSON.stringify({face:faceSel.value})});}
   catch(e){window.alert(e.message||"Qualification impossible.");faceSel.disabled=false;return;}
   await loadStats();await openDossier(dossier.id,refreshWarning);
  });
  faceLabel.append(faceSel);
  links.append(" · ",faceLabel);
 }
 li.append(handle,info,links);list.append(li);
 }
 row.append(list);
 }
 if(canWrite()){
 const zone=el("div","admin-dropzone");
 zone.setAttribute("role","region");
 zone.setAttribute("aria-label","Dépôt de fichiers pour "+doc.label);
 const hint=el("p","admin-dropzone-hint","Glissez-déposez vos fichiers ici");
 const formats=el("p","admin-dropzone-formats","Formats acceptés : PDF, JPG, PNG, WEBP, HEIC — même contrôles que le sélecteur classique.");
 const pick=el("label","admin-upload-pick");
 const input=el("input");input.type="file";input.multiple=true;input.accept=ACCEPT;
 const inputId="admin-file-"+doc.key+"-"+Math.random().toString(36).slice(2,9);
 input.id=inputId;pick.htmlFor=inputId;
 input.setAttribute("aria-label","Ajouter une pièce reçue au comptoir pour "+doc.label);
 const pickText=el("span","","Parcourir et sélectionner un fichier");
 pick.append(input,pickText);
 const status=el("p","admin-dropzone-status");status.hidden=true;
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 let uploading=false,dragDepth=0;
 const idleStatus=files.length?"Vous pouvez ajouter un autre fichier pour cette pièce.":"Déposez un ou plusieurs fichiers pour cette pièce, ou utilisez Parcourir.";
 status.textContent=idleStatus;status.hidden=false;
 const clearDrag=()=>{dragDepth=0;zone.classList.remove("is-dragover");};
 const isFileDrag=dt=>{
  if(outboundDrag)return false;
  if(!dt)return false;
  const types=dt.types?Array.from(dt.types):[];
  if(types.includes("Files") || types.includes("application/x-moz-file"))return true;
  if(dt.items && dt.items.length)return Array.from(dt.items).some(it=>it.kind==="file");
  return false;
 };
 const sendFiles=async fileList=>{
  if(uploading)return;
  const list=fileList?Array.from(fileList):[];
  if(!list.length){showError(error,"Aucun fichier exploitable déposé. Formats acceptés : PDF, JPG, PNG, WEBP, HEIC.");return;}
  const body=new FormData();body.append("key",doc.key);for(const f of list)body.append("files",f,f.name);
  uploading=true;input.disabled=true;clearDrag();
  status.hidden=false;status.textContent="Envoi en cours…";error.hidden=true;zone.classList.add("is-busy");
  try{await api("dossiers/"+dossier.id+"/files",{method:"POST",body});}
  catch(e){showError(error,e.message);uploading=false;input.disabled=false;input.value="";status.textContent=idleStatus;zone.classList.remove("is-busy");return;}
  await loadStats();await openDossier(dossier.id,refreshWarning);
 };
 input.addEventListener("change",async()=>{await sendFiles(input.files);input.value="";});
 zone.addEventListener("dragenter",e=>{
  if(!isFileDrag(e.dataTransfer))return;
  e.preventDefault();e.stopPropagation();
  dragDepth++;
  if(!uploading)zone.classList.add("is-dragover");
 });
 zone.addEventListener("dragover",e=>{
  if(!isFileDrag(e.dataTransfer))return;
  e.preventDefault();e.stopPropagation();
  try{e.dataTransfer.dropEffect="copy";}catch{}
  if(!uploading)zone.classList.add("is-dragover");
 });
 zone.addEventListener("dragleave",e=>{
  if(!isFileDrag(e.dataTransfer) && dragDepth===0)return;
  e.preventDefault();e.stopPropagation();
  // Compteur de profondeur : relatedTarget est souvent null avec un glissement OS.
  dragDepth=Math.max(0,dragDepth-1);
  if(dragDepth===0)zone.classList.remove("is-dragover");
 });
 zone.addEventListener("drop",async e=>{
  e.preventDefault();e.stopPropagation();
  clearDrag();
  if(uploading)return;
  await sendFiles(e.dataTransfer?.files);
 });
 zone.addEventListener("dragend",()=>clearDrag());
 zone.append(hint,formats,pick,status);row.append(zone,error);
 }
 wrap.append(row);
 }
 }
 return wrap;
}

function actionsBlock(dossier){
 const actions=el("div","admin-actions");
 const statusLabel=el("label","field-label","Statut");statusLabel.htmlFor="status-select";
 const statusSelect=el("select","text-input");statusSelect.id="status-select";
 for(const [value,label] of Object.entries(statuses)){
 const option=el("option","",label);option.value=value;option.selected=dossier.status===value;statusSelect.append(option);
 }
 const hint=el("p","validation-hint","« Prêt » prévient le candidat par e-mail que son dossier est complet et déposé (si l’accusé candidat est activé). « Classé » sort le dossier de la file ; la conservation suit l’échéance de 2 mois après finalisation.");
 const noteLabel=el("label","field-label","Note interne");noteLabel.htmlFor="admin-note";
 const note=el("textarea");note.id="admin-note";note.value=dossier.adminNote||"";note.maxLength=4000;
 const save=el("button","next-button","Enregistrer");save.type="button";
 const saveError=el("p","field-error");saveError.hidden=true;saveError.setAttribute("role","alert");
 // L'action et le rafraîchissement sont séparés : un échec d'affichage après un enregistrement réussi n'est pas présenté comme un échec de l'action.
 save.addEventListener("click",async()=>{
 saveError.hidden=true;save.disabled=true;
 try{await api("dossiers/"+dossier.id,{method:"PATCH",body:JSON.stringify({status:statusSelect.value,adminNote:note.value})});}
 catch(e){showError(saveError,e.message);save.disabled=false;return;}
 await loadStats();await openDossier(dossier.id,refreshWarning);
 });
 actions.append(statusLabel,statusSelect,hint,noteLabel,note,save,saveError);
 return actions;
}

function deleteBlock(dossier){
 const block=el("section","admin-delete");
 block.append(el("h3","","Supprimer le dossier"));
 block.append(el("p","","Efface définitivement du serveur les réponses, les fichiers et l’historique de ce dossier (droit à l’effacement, dossier terminé). Cette action est irréversible."));
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 const button=el("button","secondary-button danger-button","Supprimer ce dossier");button.type="button";
 let armed=false,timer=0;
 const disarm=()=>{armed=false;button.textContent="Supprimer ce dossier";button.classList.remove("armed");};
 // Deux clics en moins de 8 s : pas de boîte de dialogue bloquante, mais aucune suppression par mégarde.
 button.addEventListener("click",async()=>{
 if(!armed){armed=true;button.textContent="Confirmer la suppression définitive";button.classList.add("armed");timer=setTimeout(disarm,8000);return;}
 clearTimeout(timer);button.disabled=true;error.hidden=true;
 try{await api("dossiers/"+dossier.id,{method:"DELETE"});}
 catch(e){showError(error,e.message);button.disabled=false;disarm();return;}
 resetDetail();await loadStats();await loadList();
 });
 block.append(button,error);
 return block;
}

function notifyBlock(dossier){
 const state=dossier.adminNotify||"";
 if(!["failed","uncertain","pending","skipped"].includes(state))return null;
 const block=el("section","admin-notify");
 block.append(el("h3","","Notification « nouveau dossier »"));
 block.append(el("p","","État : "+(adminNotifyStates[state]||adminNotifyLabels[state]||state)+". Le dossier est bien enregistré."));
 if(state==="uncertain"){
  block.append(el("p","","Résultat incertain : le fournisseur a peut‑être déjà accepté l’envoi. Vérifiez la boîte admin avant de renvoyer, pour éviter un doublon."));
 }else if(state==="skipped"){
  block.append(el("p","","La messagerie n’était pas configurée au moment de la soumission. Vous pouvez tenter l’envoi maintenant si elle l’est."));
 }else{
  block.append(el("p","","Vous pouvez renvoyer la notification à l’adresse admin configurée."));
 }
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 const ok=el("p","validation-hint");ok.hidden=true;
 const button=el("button","next-button",state==="uncertain"?"Retenter avec prudence":"Renvoyer la notification");button.type="button";
 button.addEventListener("click",async()=>{
  error.hidden=true;ok.hidden=true;button.disabled=true;
  try{await api("dossiers/"+dossier.id+"/notification/retry",{method:"POST",body:"{}"});}
  catch(e){showError(error,e.message);button.disabled=false;return;}
  ok.textContent="Notification renvoyée.";ok.hidden=false;
  await loadStats();await openDossier(dossier.id,refreshWarning);
 });
 block.append(error,ok,button);
 return block;
}

function requestBlock(dossier,documents){
 const block=el("section","admin-request");
 block.append(el("h3","","Demander une pièce au candidat"));
 block.append(el("p","","Un e-mail est envoyé à "+(dossier.email||"—")+" avec la liste des pièces cochées ; le dossier passe en « Pièces manquantes »."));
 // Toutes les pièces sont listées avec leur état ; celles sans fichier ou différées sont précochées (une pièce reçue peut être redemandée, par exemple si elle est illisible).
 const boxes=[];
 for(const doc of documents){
 const label=el("label","consent");
 const box=document.createElement("input");box.type="checkbox";box.value=doc.key;box.name="pieces";
 box.checked=!doc.fileCount || Boolean(doc.deferred);
 const state=doc.fileCount?" — reçue ("+doc.fileCount+" fichier(s))":doc.deferred?" — à récupérer":" — non fournie";
 label.append(box," ",doc.label+state);boxes.push(box);block.append(label);
 }
 if(!documents.length)block.append(el("p","validation-hint","Aucune pièce attendue pour ce dossier."));
 const messageLabel=el("label","field-label","Message pour le candidat");messageLabel.htmlFor="request-message";
 const message=el("textarea");message.id="request-message";message.maxLength=2000;message.rows=4;
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 const ok=el("p","validation-hint");ok.hidden=true;
 const button=el("button","next-button","Envoyer la demande");button.type="button";button.disabled=!documents.length||!dossier.email;
 button.addEventListener("click",async()=>{
 error.hidden=true;ok.hidden=true;
 const pieces=boxes.filter(b=>b.checked).map(b=>b.value);
 if(!pieces.length){error.textContent="Cochez au moins une pièce à demander.";error.hidden=false;return;}
 if(!dossier.email){error.textContent="Ce dossier n’a pas d’adresse e-mail.";error.hidden=false;return;}
 button.disabled=true;
 try{await api("dossiers/"+dossier.id+"/request",{method:"POST",body:JSON.stringify({pieces,message:message.value})});}
 catch(e){showError(error,e.message);button.disabled=false;return;}
 ok.textContent="Demande envoyée au candidat.";ok.hidden=false;
 await loadStats();await openDossier(dossier.id,refreshWarning);
 });
 block.append(messageLabel,message,error,ok,button);
 return block;
}

function mailBlock(dossier){
 const block=el("section","admin-free-mail");
 block.append(el("h3","","Envoyer un message au candidat"));
 block.append(el("p","","Destinataire : "+(dossier.email||"—")+" (adresse du dossier). Objet et message libres."));
 const subjectLabel=el("label","field-label","Objet");subjectLabel.htmlFor="free-mail-subject";
 const subject=el("input","text-input");subject.id="free-mail-subject";subject.maxLength=180;subject.required=true;
 const messageLabel=el("label","field-label","Message");messageLabel.htmlFor="free-mail-message";
 const message=el("textarea");message.id="free-mail-message";message.maxLength=4000;message.rows=5;message.required=true;
 const error=el("p","field-error");error.hidden=true;error.setAttribute("role","alert");
 const ok=el("p","validation-hint");ok.hidden=true;
 const button=el("button","next-button","Envoyer le message");button.type="button";button.disabled=!dossier.email;
 button.addEventListener("click",async()=>{
  error.hidden=true;ok.hidden=true;
  if(!subject.value.trim() || !message.value.trim()){error.textContent="Renseignez l’objet et le message.";error.hidden=false;return;}
  button.disabled=true;
  try{await api("dossiers/"+dossier.id+"/mail",{method:"POST",body:JSON.stringify({subject:subject.value,message:message.value})});}
  catch(e){showError(error,e.message);button.disabled=false;return;}
  ok.textContent="Message envoyé au candidat.";ok.hidden=false;
  await loadStats();await openDossier(dossier.id,refreshWarning);
 });
 block.append(subjectLabel,subject,messageLabel,message,error,ok,button);
 return block;
}

/* ---------- Connexion, déconnexion, filtres ---------- */
// Chaque bouton est désactivé le temps de sa requête (pas de double envoi).
loginForm.addEventListener("submit",async event=>{
 event.preventDefault();loginError.hidden=true;
 const submit=loginForm.querySelector('button[type="submit"]');submit.disabled=true;
 try{
 const user=$("#admin-user").value.trim();
 const data=await api("login",{method:"POST",body:JSON.stringify({user,password:$("#admin-password").value})});
 await showPanel({user:data.user||user,role:data.role});
 }catch(e){showError(loginError,e.message);}
 finally{submit.disabled=false;}
});
const logoutButton=$("#logout-button");
logoutButton.addEventListener("click",async()=>{
 logoutButton.disabled=true;
 // Le retour à l'écran de connexion se fait quoi qu'il arrive (session déjà expirée, réseau).
 try{await api("logout",{method:"POST"});}catch{}
 finally{logoutButton.disabled=false;}
 leavePanel();loginError.hidden=true;
});
const refreshButton=$("#refresh-button");
refreshButton.addEventListener("click",()=>{
 if(refreshButton.disabled)return;
 refreshButton.disabled=true;
 Promise.all([loadStats(),loadList()]).catch(showListError).finally(()=>{refreshButton.disabled=false;});
});
for(const input of [workflowFilter,statusFilter])input.addEventListener("change",()=>{clearQueue();loadList().catch(showListError);});
searchInput.addEventListener("input",()=>{clearTimeout(searchInput._timer);searchInput._timer=setTimeout(()=>loadList().catch(showListError),250);});
function showListError(e){if(e?.status===401)return;showError(listEmpty,e.message);}

ensureSession().catch(()=>{});
