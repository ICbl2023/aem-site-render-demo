import {randomBytes,scryptSync,timingSafeEqual,createHash} from "node:crypto";
import {readFileSync,writeFileSync,renameSync,mkdirSync} from "node:fs";
import path from "node:path";

export const ADMIN_ROLES={lecture:"Lecture",traitement:"Traitement",responsable:"Responsable"};

const SESSION_MS=8*60*60*1000;
const LOGIN_WINDOW_MS=15*60*1000;
const LOGIN_MAX=5; // échecs par IP
const LOGIN_MAX_USER=10; // échecs par identifiant connu, toutes IP confondues (attaque distribuée sur un compte)
const USER_RE=/^[a-zA-Z0-9._-]{1,64}$/;

function hashPassword(password,salt){
 return scryptSync(String(password),salt,64).toString("hex");
}
// AEM_ADMIN_ACCOUNTS="accueil:motdepasse:lecture;marie:motdepasse:traitement;luc:motdepasse:responsable" ; repli : AEM_ADMIN_PASSWORD → compte "admin" (responsable).
// Rôles : lecture (consulter seulement), traitement (par défaut : statuts, notes, relances, pièces, suppression), responsable (en plus : état technique du service).
// Les mots de passe ne doivent contenir ni « ; » (séparateur d'entrées) ni « : » (séparateur identifiant/mot de passe/rôle).
// Le nombre d'entrées ignorées (identifiant invalide, mot de passe vide, rôle inconnu, doublon) est disponible via accounts.ignored ; les valeurs ne sont jamais journalisées.
export function parseAccounts(config){
 const accounts=new Map();let ignored=0;
 for(const part of String(config.adminAccounts||"").split(";")){
  const entry=part.trim();if(!entry)continue;
  const [rawUser="",password="",rawRole=""]=entry.split(":");
  const user=rawUser.trim(),role=(rawRole.trim()||"traitement").toLowerCase();
  if(USER_RE.test(user) && password && Object.hasOwn(ADMIN_ROLES,role) && !accounts.has(user))accounts.set(user,{password,role});else ignored++;
 }
 if(!accounts.size && config.adminPassword)accounts.set("admin",{password:config.adminPassword,role:"responsable"});
 accounts.ignored=ignored;
 return accounts;
}
// Sel des mots de passe : AEM_ADMIN_SALT, sinon un sel aléatoire généré une fois et conservé dans <dataDir>/.admin/salt (jamais de valeur fixe connue).
function loadSalt(config){
 if(config.adminPasswordSalt)return String(config.adminPasswordSalt);
 if(!config.dataDir)return randomBytes(16).toString("hex");
 const file=path.resolve(config.dataDir,".admin","salt");
 try{const salt=readFileSync(file,"utf8").trim();if(salt.length>=16)return salt;}catch{/* première exécution */}
 const salt=randomBytes(16).toString("hex");
 try{mkdirSync(path.dirname(file),{recursive:true,mode:0o700});writeFileSync(file,salt,{mode:0o600});}catch(e){console.warn("[admin] Sel non enregistré ("+e.message+") : les sessions ne survivront pas à un redémarrage.");}
 return salt;
}

export function createAdminAuth(config){
 // Sessions et compteurs propres à chaque instance : deux createApp d'un même processus ne partagent rien.
 // Sessions indexées par empreinte du jeton et conservées dans <dataDir>/.admin/sessions.json : un redémarrage ne déconnecte personne.
 const sessions=new Map();
 const sessionFile=config.dataDir?path.resolve(config.dataDir,".admin","sessions.json"):"";
 const loginRates=new Map(),loginRatesByUser=new Map();
 const salt=loadSalt(config);
 const hashes=new Map(),roles=new Map();
 const accounts=parseAccounts(config);
 for(const [user,{password,role}] of accounts){hashes.set(user,Buffer.from(hashPassword(password,salt),"hex"));roles.set(user,role);}
 const enabled=hashes.size>0;
 const tokenKey=token=>createHash("sha256").update(String(token)).digest("hex");
 function loadSessions(){
  if(!sessionFile)return;
  try{
   const saved=JSON.parse(readFileSync(sessionFile,"utf8"));
   const now=Date.now();
   for(const [key,s] of Object.entries(saved))if(s && s.until>now && hashes.has(s.user))sessions.set(key,{until:s.until,user:s.user,role:roles.get(s.user)});
  }catch{/* aucun fichier ou fichier illisible : on repart sans session */}
 }
 let saveTimer=0;
 function saveSessions(){
  if(!sessionFile)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{
   try{
    mkdirSync(path.dirname(sessionFile),{recursive:true,mode:0o700});
    writeFileSync(sessionFile+".tmp",JSON.stringify(Object.fromEntries(sessions)),{mode:0o600});renameSync(sessionFile+".tmp",sessionFile);
   }catch(e){console.warn("[admin] Sessions non enregistrées : "+e.message);}
  },50);
  saveTimer.unref?.();
 }
 loadSessions();
 if(accounts.ignored)console.warn("[admin] AEM_ADMIN_ACCOUNTS : "+accounts.ignored+" entrée(s) ignorée(s) (identifiant invalide, mot de passe vide ou doublon).");
 const decoy=Buffer.from(hashPassword(randomBytes(16).toString("hex"),salt),"hex");
 function cleanSessions(){
  const now=Date.now();let changed=false;
  for(const [key,s] of sessions)if(s.until<now){sessions.delete(key);changed=true;}
  if(changed)saveSessions();
 }
 function cleanLoginRates(){
  const now=Date.now();
  for(const map of [loginRates,loginRatesByUser])for(const [key,r] of map)if(r.until<now)map.delete(key);
 }
 // Seuls les identifiants connus ont un compteur propre : pas de croissance non bornée sur des noms aléatoires.
 const userKey=user=>typeof user==="string" && hashes.has(user)?user:"";
 function loginAllowed(ip,user){
  cleanLoginRates();
  const byIp=loginRates.get(ip),byUser=loginRatesByUser.get(userKey(user));
  return (!byIp || byIp.count<LOGIN_MAX) && (!byUser || byUser.count<LOGIN_MAX_USER);
 }
 function recordLoginFailure(ip,user){
  cleanLoginRates();
  const now=Date.now();
  const bump=(map,key)=>{const rate=map.get(key)||{count:0,until:now+LOGIN_WINDOW_MS};rate.count++;map.set(key,rate);};
  bump(loginRates,ip);
  if(userKey(user))bump(loginRatesByUser,user);
 }
 function clearLoginFailures(ip,user){loginRates.delete(ip);if(userKey(user))loginRatesByUser.delete(user);}
 function createSession(user="admin"){
  cleanSessions();
  const token=randomBytes(32).toString("hex");
  sessions.set(tokenKey(token),{until:Date.now()+SESSION_MS,user,role:roles.get(user)||"traitement"});
  saveSessions();
  return token;
 }
 // Comparaison en temps constant, y compris pour un identifiant inconnu (hachage leurre).
 function verifyPassword(user,password){
  if(!enabled)return false;
  const known=typeof user==="string" && hashes.has(user);
  const expected=known?hashes.get(user):decoy;
  const actual=Buffer.from(hashPassword(String(password||""),salt),"hex");
  const same=actual.length===expected.length && timingSafeEqual(actual,expected);
  return known && same;
 }
 // Prolongation glissante : enregistrée au plus une fois par minute pour ne pas réécrire le fichier à chaque requête.
 function sessionInfo(token){
  if(!enabled || !token)return null;
  cleanSessions();
  const key=tokenKey(token),session=sessions.get(key);
  if(!session || session.until<Date.now()){sessions.delete(key);saveSessions();return null;}
  const until=Date.now()+SESSION_MS;
  if(until-session.until>60*1000){session.until=until;saveSessions();}
  return {user:session.user||"admin",role:session.role||roles.get(session.user)||"traitement"};
 }
 function sessionUser(token){return sessionInfo(token)?.user??null;}
 function verifyToken(token){return sessionUser(token)!==null;}
 function destroyToken(token){sessions.delete(tokenKey(token));saveSessions();}
 function roleOf(user){return roles.get(user)||"traitement";}
 function parseCookie(header,name){
  if(!header)return "";
  for(const part of header.split(";")){
   const [k,...rest]=part.trim().split("=");
   // Cookie illisible (séquence % invalide) : traité comme « non connecté », jamais comme une exception.
   if(k===name){const v=rest.join("=");try{return decodeURIComponent(v);}catch{return "";}}
  }
  return "";
 }
 function sessionCookie(token,basePath){
  const secure=config.origin?.startsWith("https://")?"; Secure":"";
  return `aem_admin=${encodeURIComponent(token)}; Path=${basePath||"/"}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_MS/1000)}${secure}`;
 }
 function clearCookie(basePath){
  const secure=config.origin?.startsWith("https://")?"; Secure":"";
  return `aem_admin=; Path=${basePath||"/"}; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
 }
 return {enabled,accountCount:hashes.size,ignoredAccounts:accounts.ignored,users:[...hashes.keys()],roles:ADMIN_ROLES,roleOf,sessionInfo,loginAllowed,recordLoginFailure,clearLoginFailures,createSession,verifyPassword,sessionUser,verifyToken,destroyToken,parseCookie,sessionCookie,clearCookie};
}
