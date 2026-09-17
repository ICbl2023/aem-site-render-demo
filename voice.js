import {labelWithIcon} from "./icons.js";
const SpeechRecognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition;
const Synth=globalThis.speechSynthesis;
export const voiceSupported=Boolean(SpeechRecognition);
export const speechSupported=Boolean(Synth);

// Voix françaises plus naturelles (Apple Amélie/Thomas, Windows Denise/Hortense, Chrome « Google français »).
// On évite la première voix fr-FR du navigateur : souvent une voix compacte ou de démonstration.
const PREFERRED=/amélie|amelie|thomas|audrey|marie|denise|hortense|julie|google français|google francais|natural|neural|online|enhanced|premium|superieure|supérieure/;
const AVOID=/compact|novelty|zarvox|whisper|fred|kathy|princess|junior|bad news|good news|bells|boing|bubbles|cellos|deranged|jester|organ|trinoids|albert|bahh/;
function scoreVoice(voice){
 const lang=(voice.lang||"").toLowerCase(),name=(voice.name||"").toLowerCase();
 if(!lang.startsWith("fr"))return -100;
 let score=lang==="fr-fr"?24:lang.startsWith("fr-")?8:0;
 if(PREFERRED.test(name))score+=40;
 if(voice.localService)score+=6;
 if(AVOID.test(name))score-=60;
 return score;
}
export function pickFrenchVoice(voices=Synth?.getVoices?.()||[]){
 const ranked=voices.filter(v=>(v.lang||"").toLowerCase().startsWith("fr")).map(v=>({v,s:scoreVoice(v)})).sort((a,b)=>b.s-a.s);
 return ranked[0]?.v||null;
}
function voicesReady(){
 if(!Synth)return Promise.resolve([]);
 const have=Synth.getVoices();
 if(have.length)return Promise.resolve(have);
 return new Promise(resolve=>{
  const done=()=>{Synth.removeEventListener("voiceschanged",done);resolve(Synth.getVoices());};
  Synth.addEventListener("voiceschanged",done);
  setTimeout(done,800);
 });
}
export function warmVoices(){return voicesReady();}
// Phrases enregistrées par AEM (voice/manifest.json : phrase normalisée → fichier). Une vraie voix d'accueil, toujours la même ;
// la synthèse du navigateur ne sert que si la phrase n'a pas été enregistrée ou si le fichier manque.
let manifestPromise=null,currentClip=null;
const clipKey=text=>String(text).replace(/[«»]/g,"").replace(/\s+/g," ").trim().toLowerCase();
function manifest(){
 if(!manifestPromise)manifestPromise=fetch("./voice/manifest.json").then(r=>r.ok?r.json():{}).catch(()=>({}));
 return manifestPromise;
}
function playClip(src){
 return new Promise(resolve=>{
  try{
   const audio=new Audio(src);currentClip=audio;let done=false;
   const end=ok=>{if(done)return;done=true;if(currentClip===audio)currentClip=null;resolve(ok);};
   audio.addEventListener("ended",()=>end(true));audio.addEventListener("error",()=>end(false));
   audio.play().catch(()=>end(false));
   setTimeout(()=>end(true),45000);
  }catch{resolve(false);}
 });
}
export function stopSpeaking(){
 if(currentClip){try{currentClip.pause();}catch{/* déjà arrêté */}currentClip=null;}
 if(Synth)try{Synth.cancel();}catch{/* synthèse indisponible */}
}
export async function speakFrench(text){
 if(!text)return;
 stopSpeaking();
 const clips=await manifest();
 const file=clips && typeof clips==="object"?clips[clipKey(text)]:null;
 if(file && /^[a-z0-9][a-z0-9._-]*\.(?:mp3|ogg|m4a)$/i.test(file) && await playClip("./voice/"+file))return;
 if(!Synth)return;
 try{
 const voice=pickFrenchVoice(await voicesReady());
 const spoken=String(text).replace(/[«»]/g,"");
 const u=new SpeechSynthesisUtterance(spoken);
 u.lang=voice?.lang||"fr-FR";
 if(voice)u.voice=voice;
 u.rate=0.96;u.pitch=0.98;
 await new Promise(resolve=>{
  u.onend=()=>resolve();u.onerror=()=>resolve();
  Synth.speak(u);
  setTimeout(resolve,Math.min(45000,3000+spoken.length*90));
 });
 }catch{/* synthèse indisponible : le texte reste à l'écran */}
}

export function attachVoice(input,{onResult,onError}){
 if(!voiceSupported)return null;
 let active=null;
 const wrap=el("div","voice-control");
 const btn=el("button","voice-button");btn.append(labelWithIcon("mic","Dicter",18));
 btn.type="button";btn.title="Saisie vocale (français)";btn.setAttribute("aria-label","Activer la saisie vocale");
 const hint=el("p","validation-hint voice-hint");hint.textContent="Appuyez sur le micro et parlez clairement. La reconnaissance vocale est assurée par le service de votre navigateur (Google ou Apple) ; vous pouvez toujours corriger au clavier.";
 const stop=()=>{if(active){try{active.stop();}catch{}active=null;}btn.classList.remove("listening");btn.replaceChildren(labelWithIcon("mic","Dicter",18));};
 btn.addEventListener("click",()=>{
 if(active){stop();return;}
 active=new SpeechRecognition();
 active.lang="fr-FR";active.interimResults=false;active.maxAlternatives=1;
 btn.classList.add("listening");btn.replaceChildren(labelWithIcon("stop","Arrêter",18));
 active.onresult=event=>{
 const text=event.results[0]?.[0]?.transcript?.trim();
 if(text)onResult(text);
 stop();
 };
 active.onerror=event=>{stop();onError?.(event.error);};
 active.onend=()=>stop();
 try{active.start();}catch{stop();onError?.("start");}
 });
 wrap.append(btn,hint);
 input.closest(".field-block")?.append(wrap);
 return stop;
}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
