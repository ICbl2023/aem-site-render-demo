# Brief Codex — collaboration avec Cursor Grok

Tu travailles **avec** un autre agent (Cursor Grok 4.6) sur le même dépôt. Tu n’es pas seul : Grok a déjà fait l’étape 1+2 des brouillons multi-appareils et un passage de stabilisation. Ton rôle : **deuxième paire d’yeux + débloquer ce que Grok n’a pas pu faire sur cette machine Windows**.

Projet : `C:\Users\santi\Documents\site-AEM\aem-site-complet-2026-09-13-ccf49d43`  
Node 22+, `type: module`. Paquet autonome généré dans `questionnaires-autonomes/` (gitignoré) via `npm run build:questionnaires`.

Écris ton rapport final dans `test-results/codex-rapport.md` (créer `test-results/` si besoin).

---

## Contraintes (non négociables)

- Ne change **pas** la logique métier du questionnaire (`logic.js`) sans raison de bug réel.
- Ne refais **pas** le questionnaire.
- **Pas de QR code.**
- Ne déploie **rien** sur Render / production.
- Ne prétends **jamais** qu’un test Safari/WebKit a réussi s’il n’a pas réellement tourné.
- Distingue toujours : testé auto / inspecté dans le code / à tester sur vrai iPhone / non vérifié.
- Après toute modification de fichiers sources servis au navigateur ou au serveur, lance `npm run build:questionnaires`.
- Ne commite pas, ne pousse pas, ne touche pas `.env` ni les secrets.
- PowerShell : pas de `&&` ; enchaîne avec `;` et `$LASTEXITCODE`.

---

## État actuel (déjà fait par Grok)

Système de brouillon multi-appareils :

- Réponses + fichiers côté serveur (`draft-storage.js`, routes `/api/draft*`).
- Jeton `draftId.secret` dans le hash `#r=` (pas dans la query).
- Conflit optimiste `revision` → HTTP 409 `DRAFT_CONFLICT`.
- Après envoi : `consumeDraft` via en-tête `X-AEM-Draft` (réparé : `sendTo` avait été cassé).
- Mails admin **sans** pièces jointes (`AEM_MAIL_ATTACHMENTS=0`) ; fichiers dans l’admin.
- Render prod YAML : `AEM_DRAFT_DIR=/var/data/aem-brouillons` sur disque persistant. Non déployé.

Correctifs Safari/hors-ligne récents (à relire, pas à défaire) :

- `app.js` : « Prendre en photo » **sans** `DataTransfer` (`ingestFiles`).
- `draft-ui.js` : copie du lien avec repli `execCommand` ; bouton Réessayer si offline ; événement `online` relance la sauvegarde.
- `draft-remote.js` : en offline, la `revision` renvoyée reste **celle du serveur** (évite un 409 au retour réseau).

Tests déjà verts sur cette machine :

- `npm test` → 100/100
- `npm run test:drafts` → 15 scénarios Chrome (dont hors-ligne + caméra)
- `npm run test:cross-device` → 7/7
- `npm run test:compatibility` → Chrome ANTS/Permis + mails sans PJ ; WebKit **skipped**
- `npm run test:drafts:webkit` → skip honnête, pas un succès

---

## Problème machine (ne pas « contourner » dans le code produit)

Playwright WebKit Windows :

- Paquet présent : `.browser-cache/webkit-2359/` contient `icuuc77.dll` **et** `Playwright.exe`.
- `Playwright.exe` plante (exit `-1058471934` / `Target page, context or browser has been closed`).
- Même avec le dossier WebKit en tête du PATH et `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`.
- Ce n’est **pas** un bug du questionnaire. Ne copie **pas** de DLL dans `System32`.

Git n’est pas dans le PATH. L’outil Cursor Origin n’est pas supporté sur Windows natif. Ne promets pas « quiconque a le lien ».

---

## Tes missions (dans cet ordre)

### 1. Revue ciblée (lecture + correctifs seulement si bug réel)

Relis : `draft-storage.js`, `draft-remote.js`, `draft-ui.js`, `app.js` (upload/caméra + `X-AEM-Draft` à l’envoi), `server.js` (`consumeDraft`, routes draft, submit).

Vérifie surtout :

- un lien invalide ne révèle rien ;
- pas de mélange de fichiers entre brouillons ;
- fichiers de brouillon jamais publics ;
- brouillon invisible dans l’admin avant envoi ;
- après envoi, le lien est mort ;
- 409 : pas d’écrasement silencieux ;
- hors-ligne : pas de 409 contre soi-même au retour (déjà corrigé, confirme) ;
- Safari iOS : pas de `DataTransfer` pour la caméra (déjà corrigé, confirme) ;
- `questionnaires-autonomes/` est bien régénéré après tes edits.

Si tu trouves un bug réel, corrige-le avec un test. Si le comportement est voulu, ne « corrige » pas le produit pour faire passer un test.

### 2. WebKit / Safari — diagnostic environnement, pas de rustine produit

- Confirme le crash Playwright (ne pas inventer un succès).
- Si **WSL** est disponible et qu’on peut y lancer WebKit **sans** installer de paquets système risqués, fais-le et rapporte le résultat réel.
- Sinon, rédige dans ton rapport une **checklist manuelle iPhone/iPad** (parcours Audrey : téléphone → photo identité → lien → autre appareil → modification → retour → envoi ; plus : sans lien, expiration, conflit, mode avion). Pas de QR.

### 3. Publication / Git — seulement si c’est propre et local

- Si tu peux rendre `git` utilisable **sans** casser la machine (ex. Git déjà installé hors PATH), note le chemin.
- N’installe pas Git silencieusement si ça demande un installateur / des droits admin.
- Ne crée pas de dépôt distant, ne pousse rien, ne déploie pas Render.

### 4. Tests à relancer après tes changements

```
npm test
npm run test:drafts
npm run test:cross-device
npm run test:drafts:webkit
npm run test:compatibility
npm run build:questionnaires
```

Note succès / échec / skip, et si l’échec est produit vs test vs environnement.

---

## Fichiers importants

| Fichier | Rôle |
|---|---|
| `draft-storage.js` | Disque brouillons, jeton, 409, fichiers, purge |
| `draft-remote.js` | Client serveur + IndexedDB, `#r=`, offline |
| `draft-ui.js` | Barre de sauvegarde, lien, messages |
| `app.js` | Questionnaire, uploads, `X-AEM-Draft` au submit |
| `server.js` | Routes draft + `consumeDraft` |
| `render-production.yaml` | Disque persistant `/var/data/aem-brouillons` |
| `tests/drafts-server.test.js` | API, sécu, redémarrage, admin invisible |
| `tests/drafts-browser.js` | Chrome, hors-ligne, caméra |
| `tests/cross-device-check.js` | Deux profils navigateur |
| `tests/webkit-available.js` | Skip WebKit honnête |
| `tests/compatibility.js` | Mails sans PJ + Chrome ; WebKit skip |

---

## Format du rapport (`test-results/codex-rapport.md`)

1. Bugs trouvés (réels) et correctifs
2. Tests relancés (pass / fail / skip + cause)
3. WebKit : ce qui a été tenté, résultat factuel
4. Checklist iPhone (si WebKit toujours impossible)
5. Ce que Grok doit relire ensuite
6. Ce qui reste à l’humain (Santi)

Ne déclare pas le système « terminé ».
