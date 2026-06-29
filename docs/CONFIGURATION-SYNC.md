# Configuration de la synchronisation multi-appareils

La checklist utilise **Firebase Firestore** pour synchroniser les coches en temps réel entre plusieurs personnes et appareils.

## Étapes (environ 5 minutes)

### 1. Créer un projet Firebase

1. Ouvrez [https://console.firebase.google.com/](https://console.firebase.google.com/)
2. **Ajouter un projet** → nommez-le (ex. `looker-checklist-sync`)
3. Désactivez Google Analytics si vous n'en avez pas besoin
4. **Créer le projet**

### 2. Activer Firestore

1. Menu **Build** → **Firestore Database**
2. **Créer une base de données** → mode **Production**
3. Choisissez une région proche (ex. `europe-west1`)
4. Publiez les règles depuis ce dépôt (`firestore.rules`) ou collez-les dans l'onglet **Règles**

### 3. Enregistrer l'application Web

1. Page d'accueil du projet → icône **Web** `</>`
2. Nom de l'app : `looker-checklist`
3. Copiez la configuration `firebaseConfig`

### 4. Ajouter les secrets GitHub

Dans le dépôt GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :

| Secret | Valeur |
|--------|--------|
| `FIREBASE_API_KEY` | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |

### 5. Redéployer

Un push sur `main` (ou relance manuelle du workflow **Deploy GitHub Pages**) régénère `firebase-config.js` et publie la page.

## Partage avec votre consultante

1. Ouvrez la checklist
2. Cliquez **Copier le lien de partage** (l'URL contient `?room=...`)
3. Envoyez le lien — elle entre son prénom à la première visite
4. Les coches se synchronisent en temps réel

Chaque salle (`?room=xxx`) est isolée. Utilisez un identifiant unique pour votre projet (ex. `?room=audit-looker-2026`).
