# Questionnaires AEM — ANTS et Permis

## Périmètre au 10 septembre 2026

Deux questionnaires actifs et séparés :
- ANTS : /ants.html, également à la racine /.
- Permis : /permis.html.

Le début est identique : identité (nom de naissance, prénom et date de naissance
sur un seul écran « Qui êtes-vous ? ») → coordonnées → nationalité. Les pages partagent la logique et les composants, pas de données
personnelles entre onglets. Les anciennes pages d’inscription ne sont plus servies.
Les XMind et la sauvegarde initiale dans backup/ sont des sources historiques ;
les décisions explicites du responsable priment.

Le candidat répond, joint ses fichiers puis envoie. Le serveur prépare l’audit
complet et le transmet avec les pièces jointes. AEM effectue la suite manuellement.
Un espace admin protégé (`/admin.html`) permet de consulter les dossiers reçus,
changer leur statut et ajouter une note interne. Les pièces sont stockées sur le
serveur Node dans `AEM_DATA_DIR`, pas dans la boîte mail.

## Site principal et design — état du 12 septembre 2026

Le dépôt contient désormais le site complet de l'Auto-école Majolane, pas seulement
les questionnaires. Direction visuelle « La route, de jour » : fond clair (#F1F4F8),
surfaces blanches, orange AEM pour l'action, bleu du globe pour les repères, décor 3D
en CSS (ciel, soleil, route en perspective, panneaux directionnels, voiture qui avance
au défilement). Polices auto-hébergées dans `fonts/` (Overpass pour les titres,
Atkinson Hyperlegible Next pour le texte). Aucun emoji : icônes SVG (`icons.js`).

Pages (générées une fois par `build-site.py`, puis éditables à la main) :
- `index.html` : accueil, panneaux « Préparer mon dossier ANTS » et « Obtenir votre permis », formations, avis, contact.
- `formations.html`, `tarifs.html`, `demarches.html`, `inscription.html`, `apres-examen.html`, `rendez-vous.html`, `contact.html`.
- `ants.html` et `permis.html` : les deux questionnaires, atteints par des chemins distincts
  (Inscription → ANTS ; Après l'examen → Permis). Ils ne sont jamais présentés ensemble.
- `admin.html` : espace de suivi (mot de passe ou comptes nommés).

Contenu repris du site WordPress existant (offres, AAC, permis à 1 € par jour, label
qualité, horaires, tarifs) et coordonnées officielles : 46 rue de la République,
69330 Meyzieu, 04 78 31 79 85, aem69330@gmail.com. Les tarifs sont affichés comme
indicatifs ; le contrat fait foi. Les boutons « Envoyer un e-mail » ouvrent la messagerie
avec destinataire, objet et début de message préremplis selon le motif.

Scripts communs : `scene.js` (inclinaison des panneaux, route de progression au
défilement, séquence de jalon du questionnaire), `chat.js` (assistant du site),
`assist.js` (assistant de saisie du questionnaire), `icons.js`.

### Démonstration locale

```bash
npm run demo        # http://127.0.0.1:3001/ : site + questionnaires, envoi vers /test-audit
npm start           # serveur complet (.env : SMTP, AEM_ADMIN_ACCOUNTS, ANTHROPIC_API_KEY facultative)
npm test            # logique, serveur, admin
npm run build:preview   # public/ pour Netlify (site statique, sans envoi ni assistants IA)
```

Captures avant/après dans `captures-demo/`. La sauvegarde des fichiers d'avant le
redesign est dans `backup/avant-redesign-3d-2026-09-12.zip`.

### Feuille de route (réservoir d'idées, non planifié)

Prise de rendez-vous en ligne avec créneaux, standard téléphonique guidé, dossier
candidat unique réutilisé entre inscription, ANTS et fabrication du permis,
relances automatiques, comparaison développement sur mesure / CMS, outil de
gestion des contacts. Aucun de ces points n'est engagé.

## Mise en ligne et audit — état vérifié le 11 septembre 2026

Le « moteur » est le backend présent dans server.js : réception multipart,
validation des réponses et fichiers, audit calculé via logic.js, envoi SMTP.
Son existence locale ne prouve pas son déploiement sur Internet.

WordPress est le CMS du site AEM. L’hébergeur et ses capacités restent inconnus.
Aucun accès Netlify/Render ou SMTP réel n’est configuré dans ce dépôt.

Préparation livrée :
- netlify.toml + npm run build:preview : dossier public/ limité aux fichiers publics.
  Il s’agit d’une prévisualisation, sans moteur d’envoi.
- render.yaml : proposition de service Node payant et disque privé, à créer depuis
  un dépôt privé et à configurer. Aucun compte ou service n’a été créé.
- npm run check:mail : vérifie configuration puis connexion/authentification SMTP.
  Ce diagnostic n’envoie pas de mail et ne prouve pas la réception.
- npm run test:mail -- https://URL-DU-SERVEUR/ : envoie explicitement deux dossiers
  fictifs par l’endpoint candidat. Ne lancer qu’une fois le serveur configuré.
  Après un résultat incertain, vérifier la boîte avant de relancer.

Le test:mail a été exécuté contre un SMTP de laboratoire : deux audits et cinq
PDF fictifs. Aucun test vers la boîte Gmail prévue n’a encore été effectué.

Pour le vrai test, fournir/configurer :
1. Accès au service Node temporaire (ou confirmation d’un hébergement Node existant).
2. Adresse expéditrice autorisée, hôte SMTP, port, identifiant et secret SMTP.
   Saisir les secrets dans .env ou le panneau privé du serveur, jamais dans le chat.
3. URL publique du service. Sur Render, RENDER_EXTERNAL_URL fournit automatiquement
   cette origine ; AEM_ORIGIN reste prioritaire si renseigné.
4. Accès à la boîte destinataire pour constater réception et ouvrir les pièces.

La limite des fonctions Netlify à requête binaire tamponnée est d’environ 4,5 Mo,
contre 17 Mo demandés ici. Une adaptation directe ne suffit donc pas sans revoir
le transfert des fichiers. Le serveur Node temporaire conserve le fonctionnement
actuel et évite cette migration :
https://docs.netlify.com/build/functions/configuration/

Le destinataire seul ne permet pas d’envoyer un email : il faut aussi un expéditeur
et un relais autorisés. Le test public n’est pas terminé tant que la réception
des deux mails et des pièces n’est pas constatée dans la boîte prévue.

## Compatibilité iPad / Safari et documents

Panne reproduite avant correction : l’absence de crypto.randomUUID empêchait
l’affichage de la première question. Le repli utilise maintenant getRandomValues,
également cryptographique, sans remplacer les UUID par un identifiant faible.
L’appel client à Object.hasOwn a été remplacé pour les anciens Safari.
La navigation utilise le comportement de défilement standard « auto ».
Le mode Réduire les animations les désactive réellement ; le rendu de la carte
a été revérifié visuellement sous WebKit après correction.

Une aide reste visible si JavaScript est désactivé ou si le chargement échoue.
Sur iPad, ouvrir le lien HTTPS dans Safari plutôt qu’un aperçu de pièce jointe.
Le mécanisme d’aperçu de Mail/Fichiers peut ne pas exécuter JavaScript ; un fichier
HTML reçu n’équivaut pas à une page web ouverte dans Safari.
La cause exacte chez le collègue nécessite sa version d’iPadOS et sa méthode d’ouverture.

npm run test:compatibility teste WebKit avec profils iPad/iPhone et Chrome privé
de randomUUID/Object.hasOwn. Installation de WebKit nécessaire ; le test attend
les navigateurs Playwright dans .browser-cache/.
Les contrôles automatiques ne remplacent pas un essai sur l’iPad physique.

Les fichiers utilisent le sélecteur natif, plusieurs fichiers, PDF et image/*,
sans attribut capture forcé. « Photos »/photothèque est l’accès à la galerie sur
les appareils qui le proposent. Les sources exactes (caméra, albums, fichiers)
dépendent du système et du navigateur ; aucun menu artificiel ne les remplace.
Les extensions reçues restent contrôlées comme auparavant.

La signature manuscrite n’a pas été développée : le responsable a demandé de ne
pas la commencer tant que l’envoi réel n’est pas opérationnel.

## Lancer et tester

Node.js 22 ou plus récent :
- Installation : npm.cmd ci
- Démarrage : npm.cmd start
- Tests logique / serveur : npm.cmd test
- Tests navigateur : npm.cmd run test:browser

Liens locaux :
- http://127.0.0.1:3000/ants.html
- http://127.0.0.1:3000/permis.html

Les tests navigateur utilisent Chrome installé sur Windows, chemin dans
tests/browser.js. Captures et résultats dans test-results/.
Les essais email automatisés utilisent un SMTP local, des adresses example.test
et des documents synthétiques. Ils ne prouvent pas une réception dans Gmail.

## Règles appliquées

| Sujet | Comportement |
|---|---|
| Identité | Sélection par cartes, puis fichiers directement demandés et obligatoires dans les deux parcours |
| Identité française | CNI française ou passeport français |
| Identité étrangère | Carte du pays d’origine, carte d’un pays européen, passeport étranger, titre de séjour |
| Dates | Saisie clavier JJ/MM/AAAA et calendrier séparé ; dates vides autorisées sans mention « facultatif » |
| Naissance vide | Âge inconnu : aucune branche d’âge présumée ; l’audit indique les éléments à déterminer par AEM |
| Expiration renseignée | Durée restante ou expiration affichée en évidence, sans conclusion de conformité |
| Domicile | « Quelle est votre situation ? » ; chez les parents ou justificatif à son nom |
| Justificatifs | Facture, quittance de loyer ou avis d’imposition ; mois + année uniquement |
| Chez les parents | Justificatif du parent, attestation d’hébergement et identité du parent |
| Contact | Uniquement si le candidat est mineur ; téléphone/email candidat toujours demandés |
| Permis | Fichier du permis directement demandé et obligatoire |
| Documents d’âge | Mêmes branches dans les deux questionnaires, selon âge et nationalité |
| 15 ans | ASSR 2 / à défaut ASSR 1 |
| 16 à 21 ans | ASSR 2 |
| Français de 17 ans | Recensement |
| Français de 18 à 25 ans | JDC / avis de situation |
| 26 ans et plus | Aucun justificatif lié à la JDC |
| Compléments | Justificatifs particuliers ANTS, avis médical Permis selon les branches existantes |

Une date renseignée mais impossible ou mal formée doit être corrigée ou effacée.
La saisie compacte JJMMAAAA (8 chiffres), ou MMAAAA (6 chiffres),
est également reconnue pour les claviers numériques mobiles.
Aucune durée légale de validité n’est inventée. Les dates servent à des calculs.
Les situations non définies par les sources restent à confirmer avec AEM.

## Documents et transmission

Les vrais objets File sont gardés en mémoire dans l’onglet jusqu’à l’envoi.
Retour et récapitulatif conservent les fichiers. Une modification de branche retire
les fichiers devenus sans objet. Recharger ou fermer l’onglet fait perdre la saisie.
Aucun stockage administratif dans sessionStorage/localStorage.

PDF, JPG/JPEG, PNG, HEIC/HEIF et WEBP. Plusieurs fichiers par document, aperçu lorsque
le navigateur le permet, suppression avant envoi. Noms et octets originaux conservés.
Aucune conversion ou compression automatique.

Limites inchangées : 10 Mo par fichier, 17 Mo au total, 30 fichiers.
La valeur historique est 17 × 1 024 × 1 024 octets, affichée « 17 Mo » dans le parcours.
Le serveur contrôle aussi la somme, les formats/signatures et l’association aux
documents attendus. Ces contrôles ne prouvent ni lisibilité ni conformité.

Pièce manquante, AEM recontacte : pour une pièce obligatoire que le candidat n’a pas
sous la main, une case « Je n’ai pas ce document sous la main : AEM me recontactera
pour le récupérer » lève le blocage. Les clés retenues sont envoyées dans
`answers.deferred`, validées par `answerErrors` (document attendu pour la situation
et différable) et ignorées par `missingRequiredDocuments`. Sont différables : les
pièces liées à l’âge (ASSR, recensement, JDC), le justificatif de domicile,
l’attestation d’hébergement, la pièce d’identité de l’hébergeant, le justificatif
particulier et l’avis médical. Ne le sont jamais : le document d’identité du candidat
et le permis de conduire (refus 422 côté serveur). L’audit signale chaque pièce différée
par « À FOURNIR : le candidat indique ne pas avoir ce document ; à récupérer par AEM »
et une rubrique « PIÈCES À RÉCUPÉRER PAR AEM » ; ajouter un fichier annule le report.
Si le justificatif de domicile est différé, le type et le mois du document ne bloquent
plus l’étape. L’écran de succès rappelle « AEM vous recontactera pour récupérer : … »,
la notification AEM sans pièces jointes contient la ligne « Pièces à récupérer par AEM
(candidat sans le document) : … », le dossier est enregistré `incomplete` avec
« N pièce(s) à récupérer » dans l’historique et l’espace admin affiche le marqueur
« à récupérer » dans la liste et la fiche.

Le serveur reçoit le multipart en mémoire, génère l’audit via logic.js puis remet
le mail au SMTP. Les pièces jointes ne sont pas placées dans un dossier public.
Le corps du mail contient toutes les rubriques pertinentes et tous les noms de fichiers.
Objets : « Dossier ANTS – NOM Prénom » ou « Dossier permis – NOM Prénom ».

Les reçus privés dans .runtime ne contiennent que référence UUID, empreinte et
état d’envoi pour prévenir les doublons. Ils doivent persister lors d’un redémarrage.
Le serveur est prévu pour une seule instance. En cas de confirmation incertaine,
ne pas supprimer les reçus pour tenter un nouvel envoi.

## Configuration de l’email

Le destinataire par défaut est centralisé dans server-config.js. L’adresse prévue
reste celle décidée par AEM ; AEM_RECIPIENT permet de la modifier côté serveur.

Copier .env.example vers .env localement, ou renseigner les variables dans le
panneau privé de l’hébergement :
- AEM_FROM : expéditeur autorisé par le relais SMTP.
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS : accès au relais.
- AEM_ORIGIN : origine publique exacte, sans chemin ni slash final.
- AEM_BASE_PATH : vide à la racine, ou chemin du sous-dossier.
- HOST et PORT : interface et port du serveur.
- AEM_RECEIPT_DIR : emplacement privé et persistant des reçus.

Port 465 : TLS ; autres ports : STARTTLS obligatoire.
Ne jamais mettre ces secrets dans les pages ou le JavaScript public.
Sans configuration serveur, l’envoi reste désactivé et aucune confirmation fictive
n’est affichée. Une acceptation SMTP ne prouve pas l’arrivée dans la boîte Gmail.

## Espace admin et exploitation

Accès : `/admin.html`, actif uniquement si des comptes sont configurés côté serveur.

Comptes :
- `AEM_ADMIN_ACCOUNTS="secretariat:motdepasse;responsable:motdepasse"` : comptes
  nommés, séparateur `;`, chaque entrée `identifiant:motdepasse` (identifiant :
  lettres, chiffres, `.`, `_`, `-`, 64 caractères maximum). Prioritaire. Les mots de
  passe ne peuvent contenir ni `;` ni `:`. Une entrée invalide (identifiant hors
  format, mot de passe vide, doublon) est ignorée ; le serveur journalise au
  démarrage le nombre d’entrées ignorées, jamais leur contenu.
- `AEM_ADMIN_PASSWORD` seule : compte unique `admin` (compatibilité).
- Mots de passe hachés en mémoire au démarrage (scrypt + `AEM_ADMIN_SALT`),
  comparaison en temps constant. Deux plafonds de tentatives, même réponse 429
  (l’existence d’un compte n’est pas révélée) : 5 échecs par IP → blocage
  15 minutes de cette IP ; 10 échecs sur un même identifiant connu, toutes IP
  confondues → blocage 15 minutes de cet identifiant seul (les autres comptes
  restent accessibles). Sessions de 8 h en mémoire : un redémarrage déconnecte
  tout le monde.
- `TRUST_PROXY=1` derrière Render ou un reverse proxy : l’IP retenue (limitation des
  connexions, des envois, du chat) est la dernière valeur de `X-Forwarded-For`, celle
  ajoutée par le proxy. Ce réglage suppose un seul proxy de confiance devant Node ;
  avec une chaîne de proxys, la valeur retenue serait celle du proxy intermédiaire.
  `TRUST_PROXY=1` est obligatoire derrière un proxy : sinon toutes les requêtes
  partagent l’IP du proxy et le verrou de connexion par IP devient global.
- Les requêtes admin qui modifient (POST/PATCH) exigent l’en-tête `X-AEM-Admin: 1`
  ou un `Content-Type: application/json` (les deux sont impossibles à forger depuis
  un autre site sans pré-vérification CORS, refusée ici), en plus du cookie
  `SameSite=Strict` ; sinon, réponse 403. Corps admin limités à 32 Ko.
- Robustesse : un corps JSON illisible répond 400 « Corps de requête illisible. » ;
  un cookie `aem_admin` illisible vaut « non connecté » ; toute exception imprévue
  d’une requête répond 500 « Erreur interne. » et est journalisée sans arrêter le
  processus ; un `meta.json` corrompu ou une entrée parasite dans `AEM_DATA_DIR`
  sont ignorés (journalisés, fiche 404) ; un fichier de pièce manquant répond 404.
- `/api/submit` : 20 envois par IP et par 15 minutes, mais seuls les échecs
  consomment le quota : un envoi accepté (ou le renvoi idempotent d’un envoi déjà
  accepté) est recrédité. En session collective sur un même réseau, seuls des
  échecs répétés peuvent bloquer ; la limite est fixée dans `server.js`.

Ce que l’admin voit et fait :
- Statistiques (« Reçus aujourd’hui » compte en jour civil Europe/Paris), puis ligne
  « État du service » (`GET /api/admin/status`) :
  messagerie, accusé candidat, assistant IA (`ANTHROPIC_API_KEY` présente),
  conservation, nombre de comptes, dossiers dans `AEM_DATA_DIR` ou par défaut.
- `GET /api/admin/session` renvoie `statuses` et `historyActions` (source unique des
  libellés affichés par `admin.js`) ; la fiche et les réponses PATCH/request
  renvoient `dossier.workflowLabel`.
- Note interne : 4000 caractères maximum (400 « Note trop longue » au-delà, jamais
  de troncature silencieuse) ; caractères de contrôle refusés sauf tabulation et
  sauts de ligne.
- Session expirée pendant l’utilisation (401) : `admin.js` revient à l’écran de
  connexion avec « Reconnectez-vous. » et vide la fiche en mémoire ; la déconnexion
  ramène toujours à l’écran de connexion, même si l’appel échoue. Chaque bouton est
  désactivé le temps de sa requête ; une action réussie dont le rafraîchissement
  échoue affiche « Modification enregistrée, mais l’affichage n’a pas pu être
  actualisé ».
- Fiche dossier : audit, fichiers, statut et note interne, marqueur « à récupérer »
  avec les pièces différées, bloc « Demander une pièce au candidat » (toutes les
  pièces du dossier sont listées avec leur état — « reçue (N fichier(s)) »,
  « à récupérer » ou « non fournie » — ; les pièces sans fichier et les pièces
  différées sont précochées, une pièce reçue mais illisible peut être redemandée ;
  message libre 2000 caractères), historique horodaté (auteur, action, détails).
- Les pièces attendues d’un dossier sont calculées à sa date de réception
  (`createdAt`), pas à la date du jour : un candidat qui change de tranche d’âge
  après l’envoi garde la même liste de documents dans la fiche et les demandes.
- `POST /api/admin/dossiers/:id/request` `{pieces:[clés], message}` : envoie
  « AEM — pièces à fournir pour votre dossier (réf. …) » au candidat, passe le
  dossier en « Pièces manquantes » et trace l’historique. Si le mail est refusé :
  502 et statut inchangé ; sans SMTP : 503 ; une seconde demande moins de 60 s
  après la précédente : 409 « Une demande vient d’être envoyée pour ce dossier. ».

Mails au candidat (adresse saisie dans le questionnaire, réponse vers
`AEM_RECIPIENT`) :
- Accusé de réception « AEM — votre dossier ANTS|Permis est bien reçu (réf. …) »
  après stockage : pièces reçues, pièces à fournir (différées), pièces manquantes,
  prochaines étapes, référence complète, coordonnées AEM. Son échec ne bloque
  jamais la soumission ; l’état `candidateMail` (`sent`, `failed`, `skipped`) est
  visible dans la fiche. `AEM_CANDIDATE_MAIL=0` le désactive.
- Garde-fous contre le détournement en relais de courrier : le destinataire est
  nommé par son prénom seul, seuls les libellés des pièces sont cités (jamais les
  noms de fichiers), les champs nom de naissance / prénom / nom du responsable
  refusent `://`, `www.`, `@` et plus de 80 caractères, et au plus 3 accusés par
  adresse (minuscules, espaces retirés) et par 24 h sont envoyés ; au-delà, l’état
  est `skipped` avec « plafond atteint » dans l’historique.
- La phrase des prochaines étapes dépend des pièces différées : sans report,
  « Aucune action n’est attendue de votre part pour le moment. » ; avec report,
  « préparez les pièces listées ci-dessus ; AEM vous recontactera pour convenir de
  leur transmission (réponse à cet e-mail ou dépôt à l’auto-école) ».
- La notification AEM existante est conservée. Dans les tests, le labo SMTP
  désactive l’accusé par défaut (`startHarness({candidateMail:true})` pour le tester).

Chaque dossier (`meta.json`) contient `history` : `{at, by, action, details}` avec
`action` parmi `received`, `status`, `note`, `request`, `candidate_mail` et `by`
l’identifiant admin ou `système`. Les dossiers antérieurs sans historique restent
lisibles (liste vide). Les écritures d’un même dossier (et de l’index) sont
sérialisées en mémoire : deux mises à jour simultanées ne perdent pas d’entrée.

## Assistant du site et assistant de saisie

Deux routes distinctes, décrites d’après chat-server.js, chat.js et assist.js.

`POST /api/chat` — widget « Besoin d’aide ? » (chat.js) sur les pages du site :
- Corps `{messages:[{role, content}]}` ; en-tête `X-AEM-Request: chat` obligatoire
  (403 sinon). Les 12 derniers messages sont gardés, 1000 caractères chacun,
  alternance utilisateur/assistant imposée.
- Réponse par l’IA Claude si `ANTHROPIC_API_KEY` est renseignée (consigne système :
  faits sur l’auto-école, 3 phrases maximum, JSON `{reply, actions}`), sinon guide
  par mots-clés local (horaires, tarifs, inscription, fabrication du permis, AAC,
  boîte automatique, code, handicap, contact, formations). Refus ou erreur de
  l’API : repli sur le guide, `source` vaut `ai` ou `guide`.
- `actions` : 0 à 3 liens parmi inscription, ANTS, permis, après l’examen,
  formations, tarifs, contact, horaires, téléphone.
- Jamais de données personnelles : la consigne interdit d’en demander et renvoie
  vers le questionnaire ou le téléphone si le visiteur en donne ; le widget
  l’indique (« sans données personnelles ») et garde la conversation dans l’onglet
  (sessionStorage, 20 messages). Le texte des messages n’est pas journalisé.
- Réponse IA vide, tronquée (`max_tokens`) ou hors format : repli sur le guide,
  jamais de JSON brut affiché ; les messages sans texte sont ignorés.
- Limite 40 messages par 15 minutes et par IP (429), compteur distinct de celui
  de `/api/assist`. Compteurs anonymes par jour (messages, ai, guide, errors) dans
  `<dataDir>/chat-stats.json`, 90 jours conservés, résumé visible dans
  `GET /api/admin/status` (`chat`).

`POST /api/assist` — assistant de saisie « Remplir en parlant » (assist.js) dans
les questionnaires ANTS et Permis :
- Le candidat dicte (reconnaissance vocale du navigateur, `fr-FR`) ou écrit un
  texte ; assist.js envoie `{text, fields, current, expected, known}` avec
  l’en-tête `X-AEM-Request: assist` : le catalogue des champs du parcours (clé,
  libellé, type, obligatoire, options, étape) fourni par `window.aemForm`, les
  champs de l’étape en cours, le champ de la question posée et les valeurs déjà
  saisies.
- Avec `ANTHROPIC_API_KEY`, l’IA extrait uniquement ce qui est dit explicitement et
  renvoie `{values, message}` ; chaque valeur est contrôlée côté serveur (options
  des choix, formats de dates, téléphone en chiffres, e-mail en minuscules) puis
  côté navigateur par `window.aemForm.apply` (mêmes règles que la saisie manuelle).
  Sans clé, en cas d’erreur ou de réponse hors format : `{local:true}` et
  extraction locale dans le navigateur ; avec l’IA, ses valeurs ont priorité et
  l’extraction locale complète ce qu’elle a manqué. Limite 120 demandes par
  15 minutes et par IP (429 : l’assistant prévient et continue en local).
- Extraction locale : `assist-extract.js`, module pur (sans DOM) testé par
  `tests/assist.test.js` : nom et prénom (« je m’appelle », « né le », « mon nom
  de naissance »), dates en chiffres, en lettres ou dictées avec des espaces,
  téléphones, e-mails épelés (« léa arobase gmail point com », accents retirés,
  e-mail du responsable routé à part), choix par libellé, masculin, synonyme
  (« français », « à mon nom », « carte d’identité »), négation, ordinal ou
  chiffre seul, oui/non par position, « je ne sais pas », « c’est fait ». Les
  mots vides (« oui », « euh ») ne deviennent jamais un nom.
- Le texte dicté ou écrit peut contenir des données personnelles (nom, date de
  naissance, téléphone…) et les valeurs déjà connues sont transmises avec lui ;
  le panneau l’indique au candidat (transcription par le navigateur puis analyse,
  « par un service d’intelligence artificielle si AEM l’a activé ») et lui demande
  de vérifier les champs. Le serveur ne conserve que les compteurs `ai`/`errors`.
- L’assistant remplit les champs et peut passer à l’étape suivante (case cochée
  par défaut) ; les fichiers restent à joindre à la main avec « Ajouter votre
  document » (ou à signaler comme non disponibles). Les champs facultatifs de
  l’étape (date d’expiration, mois du justificatif, e-mail du responsable…) sont
  demandés une fois chacun ; « je ne sais pas » les passe, mais pas un champ
  obligatoire (`required` transmis). Un champ rempli à la main n’est plus
  attendu : « suivant » repart de l’état du formulaire.
- Mode vocal : parler puis écouter. La dictée redémarre après chaque question ou
  relance, attend la fin de la synthèse, et rien ne continue panneau fermé
  (bouton, Échap) ; la réouverture reprend là où on s’était arrêté. Entrée dans
  la zone de réponse envoie le message sans déclencher l’étape suivante du
  questionnaire.

## Netlify : ce qui fonctionne et ce qui ne fonctionne pas

Un déploiement statique permet de tester les questionnaires, les fichiers dans
l’onglet et les récapitulatifs. Il ne démarre pas server.js et ne peut pas envoyer
les audits ni les pièces jointes par email avec l’architecture actuelle.
L’absence d’API est détectée ; le bouton d’envoi reste désactivé.

Prévisualisation Netlify (URL temporaire, sans envoi ni admin) :

```bash
npm run build:preview          # génère public/ avec bannière et en-têtes de sécurité
npm run deploy:netlify         # tente un déploiement via npx netlify-cli
```

Alternative sans CLI : glisser-déposer le dossier `public/` sur
https://app.netlify.com/drop — Netlify affiche alors une URL du type
`https://random-name.netlify.app`.

Ne jamais publier tout le dépôt : ni `.env`, serveur, `.data`, admin, sauvegarde,
XMind, tests ou reçus. Le build `public/` exclut automatiquement l’administration.

Netlify demande un adaptateur Functions pour exécuter une application Node de cette
manière. Cette migration n’est pas réalisée ici :
https://docs.netlify.com/build/frameworks/framework-setup-guides/express/

## Solution temporaire recommandée pour un vrai essai email

Conserver Netlify pour la prévisualisation ; pour l’essai complet, héberger
temporairement les pages ET server.js sur un service Node Render payant.
C’est une proposition de déploiement, pas un service déjà créé ou payé.
L’application actuelle peut y fonctionner sans réécriture du backend :

1. Créer un Web Service Node depuis un dépôt privé contenant le projet.
2. Commande de build : npm ci --omit=dev ; démarrage : npm start.
3. Utiliser une version Node prise en charge par le projet (22 ou plus récente).
4. Définir HOST=0.0.0.0 ; conserver le PORT attribué par Render.
5. Définir AEM_ORIGIN à l’origine HTTPS attribuée au service et AEM_BASE_PATH vide.
6. Renseigner les variables SMTP et AEM_FROM dans le panneau de secrets.
7. Monter un disque persistant privé, par exemple /var/data, et définir
   AEM_RECEIPT_DIR=/var/data/aem-receipts. Garder une seule instance.
8. Tester /ants.html et /permis.html depuis cette URL avec des données fictives.
9. Vérifier dans la boîte destinataire l’audit complet, les noms et les octets des
   pièces jointes. Contrôler également les indésirables.

L’offre gratuite Render bloque les ports SMTP 25/465/587 ; elle ne convient donc
pas à ce test avec le transport actuel. Le service Node et le disque sont payants ;
vérifier le tarif affiché avant de les créer.
La limite du SMTP réel doit accepter le message complet : l’encodage des pièces
augmente leur taille d’environ un tiers. Tester le cas proche de 17 Mo.

Sources vérifiées :
- https://render.com/docs/web-services
- https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports
- https://render.com/docs/disks

Un lien depuis la prévisualisation Netlify vers cette URL de test est possible.
Aucun proxy Netlify ni changement CORS n’est nécessaire lorsque le parcours complet
est ouvert sur le serveur Node. Ce raccordement public n’est pas encore configuré.

## Limites restant à vérifier

- Hébergement public et SMTP réels, puis réception à l’adresse prévue.
- Caméra, galerie et sélecteurs sur iPhone et Android physiques.
- Accès à la boîte, confidentialité et conservation des documents par AEM.
- Âge inconnu et situations non définies à traiter manuellement par AEM.
- Espace admin : statuts, notes internes, demande de pièce par mail ; pas d’édition
  des réponses candidat. Aucune réception réelle des mails candidat n’est constatée.

Les emails ne sont pas chiffrés de bout en bout. L’usage du SMTP TLS protège le
transport jusqu’au relais, sans constituer une preuve de confidentialité globale.

## Audit du 12 septembre 2026

Audit fonctionnel complet (site, questionnaires, assistants, serveur, admin) : 57 constats confirmés et corrigés, détail dans `docs/audit-2026-09-12/constats.md` ; bilan demande par demande dans `docs/audit-2026-09-12/bilan-demandes.md`. Pages introuvables : page 404 HTML servie par `server.js`.

## Assistant de saisie en onglet et version téléphone (12 septembre 2026, soir)

Dans les deux questionnaires, deux onglets au-dessus de la carte : **Formulaire** (saisie
manuelle, fichiers à joindre) et **Assistant** (conversation par messages ou à voix haute, avec
un suivi du dossier qui liste les étapes et les réponses déjà notées). L'écran d'accueil du
questionnaire propose « En parlant », « En écrivant » ou « Moi-même ». L'assistant envoie vers
l'onglet Formulaire pour les fichiers et le récapitulatif, puis reprend là où il en était au
retour. Les boutons « Dicter » sous chaque champ ont été retirés (`voice.js` reste utilisé
pour détecter la reconnaissance vocale).

Téléphone : menu dépliant (bouton Menu injecté par `scene.js`, bouton S'inscrire toujours
visible), accroche de l'accueil réorganisée (panneau de repères, soleil et route visibles,
horizon fixé à 150 px du bas), bouton d'aide réduit à une icône, pointe des panneaux à gauche
pour éviter tout débordement horizontal. Vérifié en largeur 390 px sur toutes les pages.

## Réponse à la critique du 13 septembre 2026

1. **Mentions légales et confidentialité** : `mentions-legales.html` (AEMG, SIREN 832 466 759, agrément, directeur de publication, hébergeur) et `confidentialite.html` (données, finalités, base légale, durées, droits, assistants, cookies), liées dans tous les pieds de page, dans la note des questionnaires et dans la case de consentement de l’envoi.
2. **Promesse alignée** : le menu et l’accueil disent « Préparer mon dossier ANTS » ; la page inscription précise qu’une seule étape se fait en ligne, que l’évaluation et le contrat se signent à l’agence, sans paiement ni signature sur le site.
3. **Parcours Permis** : nouvelle étape « Quelle est votre demande ? » (premier permis avec certificat d’examen CEPC, ou renouvellement avec le titre actuel) ; la pièce demandée et son libellé s’adaptent (`permit_cepc` / `permit_current`).
4. **Tarifs** : boîte automatique, heures supplémentaires et post-permis affichés comme « sur devis après évaluation » (tarifs et formations) ; les avis Google ne sont plus présentés comme « certifiés ».
5. **Un seul registre** : l’assistant de saisie vouvoie désormais, comme le site, le chat et l’admin, en gardant un ton simple.
Le chatbot ne cite plus horaires et tarifs qu’à partir de la liste fournie dans son prompt.

## Espace admin : bureau de dossiers (13 septembre 2026)

Réponse à la critique du secrétariat. `admin.html` est une file de travail, plus une liste :
- **Comptes et rôles** : `AEM_ADMIN_ACCOUNTS="accueil:mdp:lecture;marie:mdp;luc:mdp:responsable"`. Lecture consulte seulement ; traitement (défaut) change statut, note, relance, ajoute des pièces, supprime ; responsable voit en plus « Réglages du service ». Sessions conservées dans `<dataDir>/.admin/sessions.json` (un redémarrage ne déconnecte plus) ; sel aléatoire dans `<dataDir>/.admin/salt`.
- **File de travail** : six cartes cliquables (à traiter, pièces manquantes, à récupérer, en cours, relancés sans réponse depuis 10 jours, non attribués), rafraîchissement automatique chaque minute avec pastille « nouveau », classés masqués par défaut.
- **Fiche** : appeler / écrire en un clic (candidat et responsable du mineur), âge recalculé, « Suivi par » (moi ou un prénom), date d'effacement, checklist des pièces groupée avec aperçus des images, ajout d'une pièce reçue au comptoir (`POST /api/admin/dossiers/:id/files`), audit replié, fiche imprimable (`/export`), relance, suppression.
- **Statut « Prêt »** : e-mail « dossier complet et déposé » au candidat si l'accusé candidat est activé. « Classé » sort de la file et le dossier est effacé 3 mois plus tard (12 mois au plus tard pour tous).
- **Démo** : `npm run demo` sert le site sur le port 3001 avec un admin peuplé de six dossiers fictifs (comptes demo / marie / accueil, mot de passe `demo`) ; les envois du questionnaire y apparaissent aussi. `node scripts/start-demo.js --reset` repart de zéro.

## Voitures et routes (13 septembre 2026, soir)

Trois dessins, un seul style : voiture de profil sur le bandeau route de l'accueil (seule page qui le porte, juste sous le menu), voitures vues de l'arrière qui s'éloignent vers le soleil sur l'accueil, et voiture vue de l'arrière, centrée sur la route en perspective, qui avance vers le soleil à chaque étape des questionnaires. Les autres pages et l'espace admin n'ont pas de bandeau route (`scene.js` n'est plus chargé sur `admin.html`).

## Photos, voix enregistrée, contenus officiels, livraison (13 septembre 2026, soir)

- **Photos de l'école** : emplacements sur l'accueil (façade, voiture, simulateur), les formations (simulateur, salle de code, équipe) et le contact (façade, bureau). Déposer les vrais fichiers dans `photos/` avec les noms indiqués dans `photos/README.md` ; tant qu'ils manquent, un cadre « photo à fournir » s'affiche.
- **Voix de l'assistant** : le navigateur choisit la meilleure voix française installée ; mieux, AEM peut enregistrer les 49 phrases fixes (`voice/PHRASES.md`, fichiers MP3 dans `voice/`, `voice/manifest.json` déjà prêt). Une phrase enregistrée est jouée telle quelle, sinon la synthèse prend le relais. Piper (voix locale hors ligne) reste une option ultérieure.
- **Contenus repris du site officiel (vérifiés le 13/09/2026)** : accès tram T3 (5 min à pied depuis Part-Dieu) et bus 67 arrêt Salle des Fêtes ; photos d'identité offertes sur place ; dossier ANTS seul 45 €, duplicata 30 € ; numéro de déclaration d'activité de formation professionnelle 84691564969 ; lien vers le processus de réclamation d'AEM ; école fondée en 1997 ; le contrat de formation est établi avec AEM après l'évaluation (l'outil en ligne d'AEM ou sur place), jamais sur ce site.
- **Connexion admin préremplie en phase de test** : `AEM_ADMIN_PREFILL=identifiant:motdepasse` dans `.env` (vide en production).
- **Livraison** : une archive du site déposée dans `livraison/` est téléchargeable à `/telechargement/<nom>.zip` par toute personne qui connaît l'adresse exacte.

## Hébergement de test sur le VPS et mobile (13 septembre 2026, soir)

- **VPS** : la démo complète tourne sur le serveur `vps` (148.113.172.3) en HTTPS : https://aem.148-113-172-3.nip.io/ (admin prérempli `demo` / `demo`, six dossiers fictifs, envois visibles dans l'admin, pas d'e-mail). Isolée dans `/var/www/aem-site`, processus pm2 `aem-demo` sur le port 3010, vhost nginx `aem-demo`, certificat Let's Encrypt. `sh scripts/deploy-vps.sh` redéploie le dernier commit et publie une nouvelle archive téléchargeable (`/telechargement/<nom>.zip`).
- **Mobile** : premier écran de l'accueil réduit (route plus courte, repères masqués, bouton principal qui ouvre directement le dossier ANTS, panneaux visibles sans défiler) ; `viewport-fit=cover` et zone sûre pour le bouton d'aide et le pied de page ; champs à 16 px (pas de zoom iOS) ; panneau du chat calé au-dessus du clavier ; bouton « Prendre en photo » (appareil arrière) et consigne sur chaque pièce ; bouton « Appeler » sur la page rendez-vous ; admin en liste avec barre de recherche collante et bouton retour visible ; survols réservés aux pointeurs.
