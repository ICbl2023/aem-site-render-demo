// Capture immédiate du jeton de reprise (#r=…) avant tout clic sur une ancre in-page.
// Fichier externe (pas de script inline) : compatible avec Content-Security-Policy script-src 'self'.
(function () {
  try {
    var m = /[#&]r=([A-Za-z0-9._-]+)/.exec(location.hash || "");
    if (m) sessionStorage.setItem("aem-draft-hash", m[1]);
  } catch (e) { /* navigation privée */ }

  function goCard(event) {
    var card = document.getElementById("question-card");
    if (!card) return;
    if (event) event.preventDefault();
    try { card.focus({ preventScroll: false }); } catch (err) { /* */ }
    try { card.scrollIntoView(); } catch (err) { /* */ }
  }

  function bind() {
    var skip = document.querySelector("a.skip-link");
    var brand = document.querySelector("a.brand");
    if (skip) skip.addEventListener("click", goCard);
    if (brand) brand.addEventListener("click", goCard);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();