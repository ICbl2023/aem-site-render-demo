# Installer et lancer le site AEM

Prérequis : Node.js 22 ou plus récent (https://nodejs.org).

```bash
npm install                 # dépendances
npm run demo                # démonstration complète sans e-mail : http://127.0.0.1:3001/
                            # admin http://127.0.0.1:3001/admin.html (demo / demo, prérempli)
npm test                    # 85 tests
```

Pour un vrai serveur (envoi des dossiers par e-mail, comptes admin réels) :

```bash
cp .env.example .env        # puis renseigner SMTP, AEM_ORIGIN, AEM_ADMIN_ACCOUNTS
npm start                   # http://127.0.0.1:3000/
```

Le détail (pages, admin, assistants, photos à fournir, voix à enregistrer, hébergement) est dans `README.md`.
