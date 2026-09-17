# Bilan des demandes de la session (12 septembre 2026)

| Demande | État | Preuve |
|---|---|---|
| Démo d'amélioration du design, 3D, style visuel | Fait | Version sombre proposée puis remplacée par la version claire demandée ; route 3D, panneaux, voiture ; captures dans captures-demo/ |
| Finir « en mieux », aucun emoji sur les icônes | Fait, vérifié | 0 fichier avec emoji (icons.js, SVG partout) |
| Texte ANTS corrigé (dossier de conduite, pas CNI) | Fait | index/inscription/app.js |
| Contact AEM affiché | Fait, vérifié sur le site officiel | 04 78 31 79 85, aem69330@gmail.com, 46 rue de la République |
| Regrouper nom/prénom/date | Fait, testé | étape « identity » (logic.js), tests |
| « Pièce manquante, AEM me recontacte » | Fait, testé | answers.deferred, audit, mails, admin |
| Retirer le lien admin de l'accueil | Fait | plus aucun lien admin sur les pages publiques |
| Accusé de réception candidat | Fait, testé (SMTP labo) | serveur, tests admin.test.js |
| Bouton admin « demander une pièce » | Fait, testé | POST /api/admin/dossiers/:id/request |
| Confettis réservés à l'envoi réussi | Fait | app.js |
| Dictée retirée de l'e-mail, expliquée | Fait | app.js, voice.js, assistant |
| Site principal complet reconstruit, clair | Fait, vérifié | 8 pages, desktop et mobile |
| Questionnaires séparés sur le site | Fait | Inscription → ANTS ; Après l'examen → Permis |
| Chatbot IA d'orientation | Fait (IA à activer par clé) | chat.js, chat-server.js, repli mots-clés testé |
| Sécurité renforcée | Fait, revue adversariale + corrections | 53 tests |
| Espace admin renforcé | Fait, vérifié | comptes nommés, historique, demande de pièce, état du service |
| Pages dédiées (formations, tarifs, démarches, inscription, rendez-vous, contact) | Fait | build-site.py |
| Avis Google, ancienneté, Code Rousseau, Oscar 2 mis en avant | Fait | accueil, formations |
| Voiture qui avance au défilement | Fait | bandeau sous le menu |
| Chatbot qui n'invente jamais, renvoie téléphone/e-mail | Fait | prompt système + guide |
| E-mails préremplis par motif | Fait | rendez-vous, contact, pages |
| Prise de rendez-vous en ligne (créneaux) | Non fait (feuille de route) | page rendez-vous explique le mode actuel |
| Standard téléphonique, dossier unique multi-démarches, HubSpot | Non fait (feuille de route) | README |
| Assistant vocal conversationnel (mode voix / écrit / manuel) | Fait, testé en mode écrit | mode voix non testable sans micro |
| Responsive | Fait, vérifié 390 px | captures mobile |
| Voiture d'en-tête : style remis, roues correctes | Fait | zoom vérifié |
| Compte admin admin/admin | Fait | .env de démo |
| Hébergement gratuit pour Luc | Fait (temporaire) | tunnel Cloudflare ; Netlify/Render décrits |
| Style admin et site améliorés | Fait | captures |
| Soleil centré sur la route | Fait | accueil |
| Lisibilité du texte d'intro | Fait | panneau blanc translucide |
| Voitures qui roulent vers le soleil | Fait | deux voitures AEM en boucle |
| Chemins vers Rendez-vous et Tarifs depuis l'accueil | Fait, liens vérifiés | 6 liens sur l'accueil, 0 lien cassé |
| Audit complet du fonctionnement | Fait | 6 auditeurs + 58 contre-vérifications : 57 constats confirmés, tous corrigés (73 tests) |
| Voiture d'en-tête sur toutes les pages (questionnaires, admin) | Fait | bandeau route injecté par scene.js, vérifié en capture |
| Site adapté aux téléphones | Fait, vérifié 390 px | menu dépliant, accroche, bouton d'aide, aucun débordement |
| Assistant en onglet dédié (pas de dictée sous les champs) | Fait, testé | onglets Formulaire / Assistant, suivi du dossier, reprise après fichiers |
| Hébergement permanent (Mac éteint) | En attente d'un compte | Render gratuit (serveur complet) ou Netlify (statique) : connexion à faire par Darren |
| Critique du 13/09 : mentions légales + confidentialité liées au consentement | Fait | mentions-legales.html, confidentialite.html, app.js |
| Critique du 13/09 : reformuler « S’inscrire en ligne » | Fait | menu, accueil, inscription.html, formations |
| Critique du 13/09 : CEPC / permis actuel dans le parcours Permis | Fait, testé | logic.js permitType, tests |
| Critique du 13/09 : tarif boîte auto ou retirer l’implication | Fait (sur devis) | tarifs.html, formations.html |
| Critique du 13/09 : un seul registre (vouvoiement) | Fait | assist.js |
| Critique admin du 13/09 : file de travail, fiche utile, comptoir, rôles, démo | Fait, testé (84 tests) | admin.html/js/css, server.js, storage.js, admin-auth.js, scripts/start-demo.js |
