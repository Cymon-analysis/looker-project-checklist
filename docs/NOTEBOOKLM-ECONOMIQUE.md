# NotebookLM — mode économique (auth locale + serveur à la demande)

Objectif : **ne pas payer une VM 24h/24** (~15 €/mois). Vous ne payez que quand vous enrichissez des tâches.

## Coût réel

| Scénario | Coût mensuel typique |
|----------|----------------------|
| **Option A — 100 % local + tunnel** (recommandé) | **0 €** (hors Gemini/Vertex déjà en place) |
| **Option B — VM démarrée 2 h/semaine** | **~2 €** (disque) + **~0,50 €** compute |
| VM e2-small 24h/24 | ~15–18 € ❌ à éviter |

---

## Option A — Tout en local sur votre PC (0 € cloud pour NotebookLM)

Le proxy Cloud Run appelle temporairement votre PC via un **tunnel HTTPS gratuit** (Cloudflare).

### Prérequis (une fois)

- [Node.js 18+](https://nodejs.org/)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) :
  ```powershell
  winget install Cloudflare.cloudflared
  ```
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) (pour mettre à jour le proxy)
- Votre notebook : URL `https://notebooklm.google.com/notebook/XXXXXXXX`

### 1. Auth Google (une fois, sur votre PC)

**PowerShell** (si `npx` est bloqué, utilisez `npx.cmd` ou **Invite de commandes cmd**) :

```powershell
npx.cmd -y @roomi-fields/notebooklm-mcp@latest setup-auth
```

Si ça bloque encore :

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Puis relancez `npx -y @roomi-fields/notebooklm-mcp@latest setup-auth`.

→ Une fenêtre Chrome s'ouvre : connectez-vous avec **@converteo.com**.

Les identifiants sont stockés localement (pas sur GCP).

### 2. Lancer une session d'enrichissement

À chaque fois que vous voulez utiliser « Enrichir les tâches » dans la checklist :

```powershell
cd chemin\vers\looker-project-checklist
.\scripts\notebooklm-session.ps1
```

Le script :
1. Démarre NotebookLM MCP en HTTP sur `localhost:3000`
2. Ouvre un tunnel public (`*.trycloudflare.com`)
3. Met à jour `NOTEBOOKLM_API_URL` sur `looker-gemini-proxy`
4. Enregistre le notebook si besoin

**Laissez la fenêtre PowerShell ouverte** pendant l'enrichissement.

### 3. Utiliser l'app

1. Checklist → **Enrichir les tâches**
2. Quand vous avez fini : `Ctrl+C` dans PowerShell (arrête tunnel + serveur)

### 4. Arrêt

`Ctrl+C` dans le terminal du script → le tunnel se ferme, plus d'exposition publique.

---

## Option B — VM GCP seulement quand besoin (~2 €/mois)

La VM est **arrêtée par défaut**. Vous la démarrez depuis Cloud Shell uniquement pour une session d'enrichissement.

### Installation initiale (une fois, Cloud Shell)

Suivez les étapes 1–5 du guide VM dans ce document (build image + créer VM `notebooklm-mcp`), **sans** la laisser tourner en continu.

### Auth locale → copie vers la VM (une fois)

**Sur votre PC (après `setup-auth`) :**

```powershell
# Créer une archive des identifiants locaux
$src = "$env:USERPROFILE\.local\share\notebooklm-mcp"
Compress-Archive -Path "$src\*" -DestinationPath notebooklm-auth.zip -Force
```

Uploadez `notebooklm-auth.zip` dans Cloud Shell (menu ⋮ → Upload).

**Dans Cloud Shell :**

```bash
export ZONE=europe-west1-b
gcloud compute instances start notebooklm-mcp --zone=$ZONE
sleep 30

gcloud compute scp notebooklm-auth.zip notebooklm-mcp:/tmp/ --zone=$ZONE
gcloud compute ssh notebooklm-mcp --zone=$ZONE --command '
  sudo mkdir -p /opt/notebooklm-data &&
  sudo unzip -o /tmp/notebooklm-auth.zip -d /opt/notebooklm-data &&
  sudo docker restart notebooklm-mcp 2>/dev/null || true
'
```

### Démarrer une session (Cloud Shell)

```bash
cd looker-project-checklist
./scripts/notebooklm-vm-start.sh
```

Note l'URL affichée → le proxy est mis à jour automatiquement.

### Arrêter la VM (Cloud Shell, après la session)

```bash
./scripts/notebooklm-vm-stop.sh
```

→ Facturation compute arrêtée. Seul le disque (~2 €/mois) reste.

---

## Variables à connaître

| Variable | Exemple | Où |
|----------|---------|-----|
| URL notebook Google | `https://notebooklm.google.com/notebook/abc-123` | Barre d'adresse NotebookLM |
| ID MCP (libre) | `looker-weavenn` | Vous le choisissez |
| `NOTEBOOKLM_API_URL` | tunnel ou `http://IP:3000` | Proxy Cloud Run |

---

## Comparaison rapide

| | Option A (local) | Option B (VM à la demande) |
|--|----------------|---------------------------|
| Coût | 0 € | ~2 €/mois + compute session |
| PC allumé requis | Oui pendant la session | Non |
| Setup | Script PowerShell | Cloud Shell start/stop |
| Auth Google | Sur votre PC | Copiée une fois vers VM |

**Recommandation : Option A** si vous enrichissez depuis votre poste Converteo.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| « NotebookLM non connecté » | Relancer `notebooklm-session.ps1` ou `notebooklm-vm-start.sh` |
| Auth expirée | Relancer `npx.cmd … setup-auth` sur le PC |
| Tunnel mort | `Ctrl+C` et relancer le script session |
| IP VM changée | Normal si VM arrêtée — relancer `notebooklm-vm-start.sh` |
