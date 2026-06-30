# Intégration NotebookLM — enrichissement checklist / roadmap

L'application web ne peut pas appeler NotebookLM directement depuis le navigateur (authentification Google, MCP local). L'architecture est :

```
GitHub Pages (checklist)
    → Proxy Cloud Run (gemini-proxy)
        → Serveur NotebookLM MCP (HTTP REST)
            → Google NotebookLM (notebook projet)
```

Gemini (Vertex via le même proxy) structure ensuite les réponses NotebookLM en enrichissements JSON.

## Ce que ça fait

1. **Upload de documents** : code Dataform, SQL, specs, architecture… envoyés comme sources texte au notebook
2. **Enrichissement des tâches** : description, vérification, mise en place, sous-actions
3. **Nouvelles tâches** : suggestions basées sur les documents, avec détection des doublons (comme les CR weekly)

## Prérequis

- Un **notebook NotebookLM** dédié au projet Looker / Dataform
- Un **serveur NotebookLM MCP** exposé en HTTP (recommandé : [@roomi-fields/notebooklm-mcp](https://www.npmjs.com/package/@roomi-fields/notebooklm-mcp))
- Le **proxy Cloud Run** existant (`looker-gemini-proxy`) redéployé avec les variables NotebookLM

## Étape 1 — Créer le notebook NotebookLM

1. Ouvrez [NotebookLM](https://notebooklm.google.com)
2. Créez un notebook « Projet Looker / Weavenn » (ou similaire)
3. Ajoutez-y vos sources de référence (optionnel — l'app peut aussi en envoyer à la volée)
4. Notez l'**URL du notebook** : `https://notebooklm.google.com/notebook/XXXXXXXX`

## Étape 2 — Déployer le serveur NotebookLM MCP (HTTP)

### Option A — Machine locale / VM (test)

```bash
npx -y @roomi-fields/notebooklm-mcp@latest setup-auth
# Suivre l'authentification Google dans le navigateur

# Démarrer en mode HTTP
NOTEBOOKLM_TRANSPORT=http NOTEBOOKLM_PORT=3000 npx -y @roomi-fields/notebooklm-mcp@latest
```

Vérifiez : `curl http://localhost:3000/health`

### Option B — Cloud Run (production)

Déployez le serveur MCP NotebookLM sur un second service Cloud Run (ou une VM avec IP fixe) accessible depuis `looker-gemini-proxy`.

Consultez la doc du package : [notebooklm-mcp REST API](https://roomi-fields.github.io/notebooklm-mcp/)

Enregistrez le notebook dans la bibliothèque du serveur :

```bash
curl -X POST http://VOTRE_SERVEUR:3000/notebooks \
  -H "Content-Type: application/json" \
  -d '{
    "id": "looker-weavenn",
    "name": "Projet Looker Weavenn",
    "url": "https://notebooklm.google.com/notebook/VOTRE_ID"
  }'
```

## Étape 3 — Configurer le proxy Cloud Run

Ajoutez ces variables d'environnement au service `looker-gemini-proxy` :

| Variable | Exemple | Description |
|----------|---------|-------------|
| `NOTEBOOKLM_API_URL` | `https://notebooklm-mcp-xxx.run.app` | URL du serveur MCP HTTP |
| `NOTEBOOKLM_NOTEBOOK_ID` | `looker-weavenn` | ID enregistré dans `/notebooks` |
| `NOTEBOOKLM_NOTEBOOK_URL` | _(optionnel)_ | URL directe si pas d'ID |

Commande de redéploiement :

```bash
gcloud config set project lab-fileparser
cd looker-project-checklist
gcloud run deploy looker-gemini-proxy \
  --region europe-west1 \
  --source cloud-run/gemini-proxy \
  --service-account 69393870912-compute@developer.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT_ID=lab-fileparser,GCP_LOCATION=europe-west1,GEMINI_MODEL=gemini-2.5-flash-lite,ALLOWED_ORIGIN=https://cymon-analysis.github.io,ALLOWED_EMAIL_DOMAIN=converteo.com,NOTEBOOKLM_API_URL=https://VOTRE_SERVEUR_NOTEBOOKLM,NOTEBOOKLM_NOTEBOOK_ID=looker-weavenn"
```

Vérifiez :

```bash
curl https://looker-gemini-proxy-69393870912.europe-west1.run.app/health
# doit contenir "notebooklm": true

curl https://looker-gemini-proxy-69393870912.europe-west1.run.app/v1/notebooklm/status
```

## Étape 4 — Utilisation dans l'app

1. Ouvrez la page **Checklist**
2. Le bandeau « Enrichissement NotebookLM » doit afficher **NotebookLM connecté**
3. Cliquez **Enrichir les tâches**
4. (Optionnel) Uploadez des fichiers techniques
5. Sélectionnez les tâches (critiques/hautes par défaut)
6. **Lancer l'analyse** → validez les enrichissements et nouvelles tâches

Les enrichissements sur les points checklist sont stockés dans l'état partagé (`itemEnrichments`). Les todos reçoivent directement `description`, `verify`, `setup` et `subtasks`.

## Endpoints proxy

| Méthode | Route | Rôle |
|---------|-------|------|
| `GET` | `/v1/notebooklm/status` | Vérifie la config NotebookLM |
| `POST` | `/v1/notebooklm/enrich` | Pipeline complet (sources → ask → structuration Gemini) |

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| « NotebookLM non configuré » | `NOTEBOOKLM_API_URL` manquant sur Cloud Run |
| `notebooklm_not_configured` | Idem — redéployer le proxy |
| `notebooklm_empty_answer` | Notebook vide ou question sans sources pertinentes |
| Timeout | NotebookLM MCP lent — réduire le nombre de tâches ou la taille des fichiers |
| Auth expirée sur le serveur MCP | Relancer `setup-auth` sur le serveur NotebookLM |

## MCP dans Cursor (usage développeur)

Pour interroger NotebookLM depuis Cursor en local, ajoutez dans `~/.cursor/mcp.json` :

```json
{
  "mcpServers": {
    "notebooklm": {
      "command": "npx",
      "args": ["-y", "@roomi-fields/notebooklm-mcp@latest"]
    }
  }
}
```

Ceci est **indépendant** de l'intégration web : l'app checklist passe par le proxy HTTP Cloud Run.
