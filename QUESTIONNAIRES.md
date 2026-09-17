# Questionnaires ANTS et Permis autonomes — 15 septembre 2026

Ce paquet est une application Node autonome : il contient les deux questionnaires, leurs fichiers communs, l’assistant écrit, le serveur multipart, les audits, les pièces jointes privées et l’administration. Il ne nécessite pas les pages du site vitrine. Le logo et le design sont conservés.

## Tester sur cet ordinateur

Node.js 22 ou plus récent :

    npm.cmd ci --omit=dev --ignore-scripts
    npm.cmd run demo

Dans le paquet extrait, LANCER-TEST.cmd effectue ces commandes.
Depuis le projet source complet, utiliser npm.cmd run demo:questionnaires (ou npm.cmd run build:questionnaires pour reconstruire ce paquet).

- ANTS : http://127.0.0.1:3015/ants.html
- Permis : http://127.0.0.1:3015/permis.html
- Audits et pièces : http://127.0.0.1:3015/admin.html (demo / demo, prérempli).

La démonstration conserve les dossiers envoyés dans .data-questionnaires-demo. Aucun email n’est envoyé. Utiliser des documents fictifs. Les aperçus /test-audit sont temporaires ; les dossiers restent dans l’administration selon la durée de conservation serveur. Les liens localhost s’ouvrent sur l’ordinateur qui exécute ce service.

## Reprise des brouillons

Le brouillon est conservé sur le serveur d’AEM : réponses, étape atteinte et documents. C’est ce qui permet de reprendre le dossier depuis un autre appareil, ou de le transmettre à un proche via le lien de reprise. IndexedDB reste un cache local et un filet hors ligne.

**Côté serveur (`draft-storage.js`, routes `api/draft` et `api/draft/files`)**

- Les réponses, l’étape, la référence d’envoi et les pièces (contenu compris) sont enregistrées dans AEM_DRAFT_DIR, séparément des dossiers envoyés. Les brouillons n’apparaissent pas dans l’administration.
- L’accès repose sur un lien porteur d’un jeton `<draftId>.<secret>` : identifiant UUID v4 et secret de 32 octets, dont le disque ne garde que l’empreinte SHA-256, comparée en temps constant. Le jeton voyage dans le fragment de l’URL (`#r=…`), donc ni dans les journaux du serveur ni dans l’en-tête Referer.
- Le candidat peut recevoir ce lien par e-mail (`api/draft/link`, 5 envois par adresse et par 24 h) et le transmettre à un proche : c’est le mécanisme prévu pour qu’un responsable termine le dossier d’un mineur. Quiconque détient le lien peut lire et compléter le brouillon, documents compris ; c’est écrit dans le mail et dans la politique de confidentialité.
- Les pièces passent par `POST /api/draft/files` (mêmes limites et même contrôle de contenu qu’à l’envoi définitif). Une sauvegarde de réponses ne peut pas effacer une photo déjà stockée. Le conflit de révision ne s’applique qu’aux réponses : téléverser une photo pendant qu’un autre appareil répond ne doit pas échouer.
- Un brouillon expire 7 jours après sa dernière modification, échéance repoussée à chaque sauvegarde ou dépôt de pièce. Il est effacé à la première relecture après échéance, par la purge quotidienne s’il n’est jamais rouvert, et immédiatement à l’envoi du dossier ou sur « Recommencer ». AEM_DRAFTS=0 désactive complètement le partage.

**Côté navigateur (`drafts.js`, `draft-remote.js`)**

- IndexedDB conserve une copie des fichiers (Blob/File) pour éviter de les retélécharger sur le même appareil, et sert de filet complet hors ligne. Un nom de fichier seul n’est jamais présenté comme une pièce disponible.
- Chaque sauvegarde écrit d’abord en local, puis sur le serveur : une coupure réseau ne perd rien, elle est annoncée, et la synchronisation reprend au retour de la connexion. Tant qu’elle n’a pas eu lieu, les réponses et documents ne sont pas reprenables ailleurs.
- Sur un appareil qui n’a jamais eu les fichiers (le lien ouvert par un proche), les documents sont téléchargés depuis le serveur et réinjectés dans le questionnaire. S’il en manque, ils sont listés comme à réajouter.
- ANTS et Permis ont des brouillons séparés, également isolés selon l’origine et le sous-dossier du service.
- L’enregistrement local est annoncé uniquement après la validation de la transaction IndexedDB. En cas de quota ou de refus de stockage des fichiers, une sauvegarde des réponses seules est tentée et signalée.

Limites : la reprise d’un appareil à l’autre exige le lien ; sans lui, un autre navigateur ne voit rien (vérifié par `npm run test:cross-device`). La navigation privée ou le nettoyage des données effacent le cache local et la mémorisation du lien : seul le lien reçu par e-mail permet alors de reprendre. Une fermeture forcée immédiatement après une saisie peut perdre les changements non encore confirmés comme sauvegardés. Le mode écrit repart des réponses et de l’étape restaurées ; son historique de conversation n’est pas conservé.

## Héberger indépendamment du site

Installer les dépendances, configurer .env d’après .env.example, puis npm start (port local 3014 par défaut ; PORT et HOST sont configurables). Renseigner AEM_ORIGIN avec l’origine HTTPS exacte. AEM_BASE_PATH permet un sous-dossier. Un reverse proxy doit transmettre le préfixe à Node ; le frontend et l’API partagent la même origine.

Configurer AEM_DATA_DIR, AEM_RECEIPT_DIR et AEM_DRAFT_DIR vers des disques privés persistants. AEM_DRAFT_DIR doit être persistant lui aussi : sur un disque éphémère, un redéploiement ferait perdre aux candidats les questionnaires commencés et non encore envoyés. Les audits restent centralisés dans ce service pour les deux questionnaires ; les données d’un autre déploiement ne sont pas copiées automatiquement. Configurer les vrais comptes avec AEM_ADMIN_ACCOUNTS et laisser AEM_ADMIN_PREFILL vide hors démonstration.

Le stockage des dossiers et leur audit fonctionnent avec le serveur Node. SMTP est configurable pour les notifications et les emails ; ANTHROPIC_API_KEY reste facultative pour l’assistant écrit (extraction locale disponible). Ne publier ni .env, ni les répertoires privés. Un hébergement de fichiers HTML seul ne suffit pas au traitement et aux audits.

Le site vitrine peut simplement lier les deux adresses HTTPS /ants.html et /permis.html de ce service. Garder l’adresse du service stable : les liens de reprise déjà envoyés aux candidats en dépendent. Ce paquet ne met pas à jour automatiquement le VPS de test existant.

## Textes vérifiés

La phrase des 185 jours reprend la définition de résidence normale ; « en principe » conserve la place des exceptions. Elle reste purement informative, sans question, justificatif ou contrôle d’éligibilité supplémentaire.

- Service Public F1758 : https://www.service-public.gouv.fr/particuliers/vosdroits/F1758
- Service Public F1757 : https://www.service-public.gouv.fr/particuliers/vosdroits/F1757

Consultées le 15 septembre 2026. Les fiches concernent la conduite et l’échange de permis européens ; l’aide n’en déduit aucune obligation documentaire nouvelle.
