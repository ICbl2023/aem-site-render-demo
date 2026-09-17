// Jeu d'icônes SVG (trait 1.8, bouts ronds). Aucun emoji : rendu identique sur tous les appareils.
const paths={
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
 file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
 files:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
 stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7"/>',
 arrowLeft:'<path d="M19 12H5M11 6l-6 6 6 6"/>',
 arrowRight:'<path d="M5 12h14M13 6l6 6-6 6"/>',
 home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 shield:'<path d="M12 3l8 3v6c0 5-3.5 8.3-8 9-4.5-.7-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
 keyboard:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
 refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
 search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
 logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18M7 15h3m4 0h3m-10 3h3"/>',
 car:'<path d="M5 17h14M6 17v2H4v-2M20 17v2h-2v-2"/><path d="M3 17v-5l2-1 2.5-5h9L19 11l2 1v5z"/><circle cx="7.5" cy="14" r="1.2"/><circle cx="16.5" cy="14" r="1.2"/>',
 flag:'<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
 pen:'<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12.5 7.5l4 4"/>',
 send:'<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
 sparkle:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'
};
export function iconMarkup(name,size=20){
 const body=paths[name];if(!body)return "";
 return '<svg class="icon icon-'+name+'" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+body+'</svg>';
}
export function icon(name,size=20){
 const span=document.createElement("span");span.className="icon-wrap";span.innerHTML=iconMarkup(name,size);
 return span.firstElementChild||span;
}
// Libellé + icône, pour les boutons et pastilles : [svg][texte]
export function labelWithIcon(name,text,size=18){
 const frag=document.createDocumentFragment();
 frag.append(icon(name,size));
 const label=document.createElement("span");label.textContent=text;frag.append(label);
 return frag;
}
