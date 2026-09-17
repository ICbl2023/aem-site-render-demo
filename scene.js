// Mise en scène 3D : inclinaison des panneaux au pointeur, séquence de jalon sur la route, entrée du hub.
// Aucune logique métier ici : app.js reste la seule source des données et de la navigation.
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const finePointer=matchMedia("(hover: hover) and (pointer: fine)");

// Inclinaison ±max° des éléments [data-tilt] selon la position du pointeur (une frame à la fois).
function attachTilt(root){
 if(reduced.matches || !finePointer.matches)return;
 let frame=0,target=null,px=0,py=0;
 const clear=card=>{for(const p of ["--tx","--ty"])card.style.removeProperty(p);};
 const apply=()=>{
 frame=0;if(!target)return;
 const r=target.getBoundingClientRect(),max=Number(target.dataset.tilt)||6;
 const x=(px-r.left)/r.width-.5,y=(py-r.top)/r.height-.5;
 target.style.setProperty("--ty",(x*max*2).toFixed(2)+"deg");
 target.style.setProperty("--tx",(-y*max*2).toFixed(2)+"deg");
 };
 root.addEventListener("pointermove",event=>{
 const card=event.target.closest("[data-tilt]");
 if(!card){if(target){clear(target);target=null;}return;}
 if(target && target!==card)clear(target);
 target=card;px=event.clientX;py=event.clientY;
 if(!frame)frame=requestAnimationFrame(apply);
 });
 root.addEventListener("pointerleave",()=>{if(target){clear(target);target=null;}});
}

// Jalons : app.js signale un quart de parcours ; la route accélère et la voiture rebondit (tout en CSS via .is-milestone).
function watchMilestones(journey){
 if(!journey || reduced.matches)return;
 document.addEventListener("aem:milestone",()=>{
 journey.classList.add("is-milestone");
 setTimeout(()=>journey.classList.remove("is-milestone"),1200);
 });
}

// Entrée de l'accueil : panneaux qui se dressent, une seule fois par session.
function hubIntro(){
 if(!document.querySelector(".signs") || reduced.matches)return;
 let seen=false;
 try{seen=sessionStorage.getItem("aem-hub-intro")==="1";sessionStorage.setItem("aem-hub-intro","1");}catch{/* stockage indisponible : on joue l'intro */}
 if(!seen)document.documentElement.classList.add("hub-intro");
}

// Site principal : une petite route sous la navigation, la voiture avance avec le défilement jusqu'au drapeau d'arrivée.
function scrollRoad(){
 // Uniquement sur l'accueil (la page avec la scène de route) : les autres pages et l'admin restent sobres.
 const nav=document.querySelector(".site-nav");if(!nav || !document.querySelector(".hero-scene"))return;
 const road=document.createElement("div");road.className="route-progress";road.setAttribute("aria-hidden","true");
 const car=document.createElement("div");car.className="route-progress-car";
 car.innerHTML='<svg viewBox="0 0 120 56" aria-hidden="true"><ellipse cx="60" cy="52" rx="46" ry="3" fill="rgba(11,26,51,.28)"/><path d="M10 47H110Q116 47 116 41V34Q116 29 111 28L96 25 82 12Q80 10 77 10H45Q42 10 40 12L28 25 13 28Q6 29 6 34V41Q6 47 10 47Z" fill="#2B7BC4"/><path d="M31 25L41 14H58V25Z" fill="#0B1A33"/><path d="M61 14H76L91 25H61Z" fill="#0B1A33"/><path d="M34 24L42 15H50L42 24Z" fill="rgba(255,255,255,.18)"/><path d="M8 37H114" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/><rect x="109" y="31" width="6" height="5" rx="1.5" fill="#FFE08A"/><rect x="6" y="31" width="5" height="5" rx="1.5" fill="#FF5A3C"/><g class="wheel"><circle cx="32" cy="45" r="9" fill="#1B2434"/><circle cx="32" cy="45" r="4" fill="#DCE3EE"/><path d="M32 41V49M28 45H36" stroke="#1B2434" stroke-width="1.5"/></g><g class="wheel"><circle cx="88" cy="45" r="9" fill="#1B2434"/><circle cx="88" cy="45" r="4" fill="#DCE3EE"/><path d="M88 41V49M84 45H92" stroke="#1B2434" stroke-width="1.5"/></g></svg>';
 road.append(car);nav.append(road);
 let frame=0;
 let rolling=0;
 const update=()=>{frame=0;const max=document.documentElement.scrollHeight-innerHeight;const p=max>0?Math.min(1,Math.max(0,scrollY/max)):0;road.style.setProperty("--scroll",p.toFixed(3));nav.classList.add("is-rolling");clearTimeout(rolling);rolling=setTimeout(()=>nav.classList.remove("is-rolling"),400);};
 addEventListener("scroll",()=>{if(!frame)frame=requestAnimationFrame(update);},{passive:true});
 addEventListener("resize",()=>{if(!frame)frame=requestAnimationFrame(update);});
 update();
}

// Apparition douce des cartes et étapes du site principal : basée sur la position réelle à chaque défilement,
// avec un délai de sécurité qui affiche tout au bout de deux secondes. Rien n'est caché si l'utilisateur limite les animations.
function reveals(){
 const nav=document.querySelector(".site-nav");if(!nav)return;
 const items=[...document.querySelectorAll(".card,.steps li,.price,.figures li,.mail-list li")];
 if(reduced.matches){document.documentElement.classList.add("no-reveal");return;}
 items.forEach((n,i)=>{n.classList.add("reveal");n.style.transitionDelay=(i%4)*60+"ms";});
 let timer=0,last=0;
 const check=()=>{
 timer=0;last=Date.now();nav.classList.toggle("is-scrolled",scrollY>8);
 const limit=innerHeight*.92;
 for(const n of items)if(!n.classList.contains("is-visible") && n.getBoundingClientRect().top<limit)n.classList.add("is-visible");
 };
 // Pas de requestAnimationFrame ici : un simple délai de 80 ms suffit et reste actif même si l'onglet n'est pas au premier plan.
 const ask=()=>{if(Date.now()-last>80)check();else if(!timer)timer=setTimeout(check,80);};
 addEventListener("scroll",ask,{passive:true});addEventListener("resize",ask);
 check();setTimeout(check,300);
 setTimeout(()=>items.forEach(n=>n.classList.add("is-visible")),2000);
}

// Site principal sur petit écran : bouton Menu qui déplie la liste des pages sous la barre ; le bouton S'inscrire reste visible.
function mobileMenu(){
 const nav=document.querySelector(".site-nav"),inner=nav?.querySelector(".site-nav-inner"),menu=nav?.querySelector(".site-menu");if(!nav || !inner || !menu)return;
 if(!menu.id)menu.id="site-menu";
 const box=document.createElement("div");box.className="nav-mobile";
 const cta=menu.querySelector(".menu-cta");
 if(cta){const short=document.createElement("a");short.className="next-button nav-cta";short.href=cta.getAttribute("href");short.textContent=cta.dataset.short||cta.textContent;box.append(short);}
 const toggle=document.createElement("button");toggle.type="button";toggle.className="menu-toggle";toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-controls",menu.id);
 toggle.innerHTML='<svg class="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg><span>Menu</span>';
 box.append(toggle);inner.append(box);nav.classList.add("has-toggle");
 const set=open=>{nav.classList.toggle("is-open",open);document.documentElement.classList.toggle("menu-open",open);toggle.setAttribute("aria-expanded",String(open));toggle.querySelector("span").textContent=open?"Fermer":"Menu";};
 toggle.addEventListener("click",()=>set(!nav.classList.contains("is-open")));
 menu.addEventListener("click",event=>{if(event.target.closest("a"))set(false);});
 document.addEventListener("keydown",event=>{if(event.key==="Escape" && nav.classList.contains("is-open")){set(false);toggle.focus();}});
 document.addEventListener("click",event=>{if(nav.classList.contains("is-open") && !nav.contains(event.target))set(false);});
}

// Photos de l'école : tant qu'un fichier manque dans photos/, le cadre indique quoi fournir au lieu d'une image cassée.
function photoFallbacks(){
 for(const img of document.querySelectorAll(".photo img")){
  const mark=()=>{const figure=img.closest(".photo");if(!figure || figure.classList.contains("photo-missing"))return;figure.classList.add("photo-missing");const box=document.createElement("div");box.className="photo-placeholder";box.textContent="Photo à fournir par AEM : "+(figure.querySelector("figcaption")?.textContent||img.alt);img.replaceWith(box);};
  // Les images sont chargées à la demande (lazy) : on vérifie tout de suite que le fichier existe, sans attendre le défilement.
  img.addEventListener("error",mark,{once:true});
  if(img.complete && img.naturalWidth===0)mark();
  else fetch(img.currentSrc||img.src,{cache:"force-cache"}).then(r=>{if(!r.ok)mark();}).catch(mark);
 }
}
attachTilt(document.body);
photoFallbacks();
mobileMenu();
watchMilestones(document.querySelector(".journey"));
hubIntro();
scrollRoad();
reveals();
