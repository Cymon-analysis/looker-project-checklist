# Proxy Vertex AI pour Gemini (sans clé API)

Quand les **clés API Google sont désactivées** par votre organisation, ce proxy Cloud Run appelle **Vertex AI** avec un **compte de service**.

## Votre configuration

| Paramètre | Valeur |
|-----------|--------|
| Projet GCP | `lab-fileparser` |
| Région | `europe-west1` |
| Compte de service | `69393870912-compute@developer.gserviceaccount.com` |

---

## Étape 1 — Prérequis GCP (une seule fois)

Dans un terminal avec `gcloud` connecté au bon compte :

```bash
gcloud config set project lab-fileparser

gcloud services enable aiplatform.googleapis.com run.googleapis.com cloudbuild.googleapis.com

gcloud projects add-iam-policy-binding lab-fileparser \
  --member="serviceAccount:69393870912-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

---

## Étape 2 — Déployer le proxy sur Cloud Run

Depuis la racine du dépôt :

```bash
gcloud run deploy looker-gemini-proxy \
  --project lab-fileparser \
  --region europe-west1 \
  --source cloud-run/gemini-proxy \
  --service-account 69393870912-compute@developer.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=lab-fileparser,GCP_LOCATION=europe-west1,GEMINI_MODEL=gemini-2.5-flash-lite,ALLOWED_ORIGIN=https://cymon-analysis.github.io"
```

À la fin, notez l’**URL du service** (ex. `https://looker-gemini-proxy-xxxxx-ew.a.run.app`).

### (Optionnel) Secret partagé

Pour limiter les appels non autorisés, ajoutez un secret :

```bash
# Choisissez une valeur aléatoire longue
gcloud run services update looker-gemini-proxy \
  --project lab-fileparser \
  --region europe-west1 \
  --set-env-vars "GEMINI_PROXY_SECRET=VOTRE_SECRET_ICI"
```

---

## Étape 3 — Tester le proxy

```bash
curl -s https://VOTRE-URL.run.app/health
```

Réponse attendue : `{"ok":true,"project":"lab-fileparser","location":"europe-west1"}`

---

## Étape 4 — Configurer GitHub

Dépôt → **Settings** → **Secrets and variables** → **Actions** :

| Secret | Valeur |
|--------|--------|
| `GEMINI_PROXY_URL` | URL Cloud Run (sans `/` final) |
| `GEMINI_PROXY_SECRET` | (optionnel) même secret que ci-dessus |

Vous pouvez **laisser ou supprimer** `GEMINI_API_KEY` — le proxy est prioritaire.

Relancez **Deploy GitHub Pages** (Actions → Run workflow).

---

## Vérification sur le site

1. Ctrl+F5 sur la page CR Weekly
2. Le bandeau « Gemini non configuré » doit disparaître
3. Collez un CR → **Analyser avec Gemini**
4. Message attendu : `Gemini OK (gemini-2.5-flash-lite) — …`

---

## Sécurité

- Le **JSON du compte de service** ne doit **jamais** être mis dans GitHub ni dans le site.
- Cloud Run utilise l’identité du compte de service attaché au service.
- CORS limité à `https://cymon-analysis.github.io`.
- Le secret proxy est visible côté client (comme une clé API) mais réduit les abus externes.

---

## Dépannage

| Erreur | Action |
|--------|--------|
| `403` / `Permission denied` | Vérifiez le rôle `roles/aiplatform.user` sur le compte de service |
| `404` modèle | Vérifiez que Vertex AI API est activée et la région `europe-west1` |
| `401 unauthorized` | Vérifiez `GEMINI_PROXY_SECRET` identique GitHub ↔ Cloud Run |
| CORS | Vérifiez `ALLOWED_ORIGIN` sur Cloud Run |
