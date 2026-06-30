# Import agenda Google (OAuth Converteo)

Cette fonctionnalité permet d'importer depuis la page **CR Weekly** les réunions dont le titre contient **Weavenn**, avec les **notes Gemini** attachées à l'événement Calendar.

## Architecture

```
Navigateur (OAuth utilisateur @converteo.com)
    → Proxy Cloud Run (Calendar + Drive API)
    → Notes Gemini (Google Doc)
    → Gemini (structuration CR + actions)
    → Checklist / Roadmap (flux existant)
```

Chaque utilisateur se connecte avec **son propre compte Google Workspace Converteo**. Le token reste dans `sessionStorage` du navigateur (pas stocké côté serveur).

---

## Étape 1 — APIs Google (projet `lab-fileparser`)

```bash
gcloud config set project lab-fileparser

gcloud services enable calendar-json.googleapis.com drive.googleapis.com
```

---

## Étape 2 — Client OAuth (écran de consentement)

1. Console GCP → **APIs & Services** → **OAuth consent screen**
2. Type : **Internal** (organisation Converteo uniquement)
3. Scopes à ajouter :
   - `.../auth/calendar.readonly`
   - `.../auth/drive.readonly`
   - `openid`, `email`, `profile` (identification du compte à la connexion)

---

## Étape 3 — Identifiants OAuth Web

1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
2. Type : **Web application**
3. **Authorized JavaScript origins** :
   - `https://cymon-analysis.github.io`
   - (optionnel dev) `http://localhost:8080`
4. Copier le **Client ID** (pas besoin du secret pour ce flux)

---

## Étape 4 — Secrets GitHub

Dans le dépôt `looker-project-checklist` → **Settings** → **Secrets** :

| Secret | Valeur | Attention |
|--------|--------|-----------|
| `GOOGLE_OAUTH_CLIENT_ID` | `123456789-xxxx.apps.googleusercontent.com` | Client ID OAuth Web |
| `GEMINI_PROXY_URL` | `https://looker-gemini-proxy-XXXX.europe-west1.run.app` | **URL du proxy** (sans slash final) |
| `GEMINI_PROXY_SECRET` | (optionnel) | |
| `GEMINI_API_KEY` | Laisser **vide** si vous utilisez le proxy | **Ne pas** y mettre l'URL du proxy |

> Si l'URL du proxy est dans `GEMINI_API_KEY` au lieu de `GEMINI_PROXY_URL`, l'agenda Google ne fonctionnera pas.

Relancer le workflow **Deploy GitHub Pages**.

---

## Étape 5 — Redéployer le proxy Cloud Run

Le proxy doit inclure les routes Calendar (`/v1/calendar/*`).

```bash
gcloud run deploy looker-gemini-proxy \
  --project lab-fileparser \
  --region europe-west1 \
  --source cloud-run/gemini-proxy \
  --service-account 69393870912-compute@developer.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=lab-fileparser,GCP_LOCATION=europe-west1,GEMINI_MODEL=gemini-2.5-flash-lite,ALLOWED_ORIGIN=https://cymon-analysis.github.io,ALLOWED_EMAIL_DOMAIN=converteo.com"
```

---

## Utilisation

1. Page **CR Weekly** → **Connecter mon agenda**
2. Choisir un compte `@converteo.com`
3. **Importer une réunion Weavenn** → sélectionner la réunion
4. Le formulaire CR est pré-rempli (titre, date, participants, notes)
5. Gemini structure notes/actions → **Enregistrer** → importer vers la checklist

---

## Prérequis côté réunions

- Titre de l'événement contient **Weavenn**
- Fonction **« Prendre des notes pour moi »** activée dans Google Meet (Workspace + Gemini)
- Les notes sont attachées à l'événement Calendar (« Notes by Gemini »)
- L'utilisateur connecté a accès à l'événement et au Google Doc

---

## Dépannage

| Problème | Cause probable |
|----------|----------------|
| « Non configuré » | `GOOGLE_OAUTH_CLIENT_ID` absent ou Pages non redéployé |
| « domain_not_allowed » | Compte autre que `@converteo.com` |
| « Sans notes Gemini » | Notes non générées ou pas encore attachées à l'événement |
| Erreur 403 Drive | L'utilisateur n'a pas accès au Doc Gemini |
| CORS | Vérifier `ALLOWED_ORIGIN` sur Cloud Run |

---

## Sécurité

- Validation du domaine email côté proxy (`ALLOWED_EMAIL_DOMAIN=converteo.com`)
- Token OAuth utilisateur transmis uniquement en `Authorization: Bearer` au proxy
- Aucun refresh token stocké côté serveur
- Scopes en lecture seule (Calendar + Drive)
