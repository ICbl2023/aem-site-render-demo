// Playwright WebKit sur Windows : le paquet est bien installé (.browser-cache/webkit-*/icuuc77.dll),
// mais le validateur hôte et le processus Playwright.exe exigent des dépendances système
// (ICU 77 vue depuis le PATH Windows). Ce n'est pas un défaut du questionnaire.
export const WEBKIT_SKIP_HINT="SKIPPED (environnement Windows) : Playwright WebKit ne démarre pas ici (dépendance hôte icuuc77.dll / processus Playwright.exe). Ce n’est pas un échec du questionnaire. Safari reste à vérifier sur un iPhone ou iPad réel.";

export async function webkitLaunchError(){
 try{
  const {webkit}=await import("playwright");
  const browser=await webkit.launch({headless:true});
  await browser.close();
  return null;
 }catch(error){
  return String(error.message||error);
 }
}
