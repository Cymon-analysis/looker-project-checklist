# Session NotebookLM locale + tunnel Cloudflare + mise à jour du proxy Cloud Run
# Usage : .\scripts\notebooklm-session.ps1
# Laissez ce terminal ouvert pendant l'enrichissement dans la checklist.

$ErrorActionPreference = "Stop"

# Évite l'erreur PSSecurityException sur npx.ps1 (policy Windows)
$Npx = "npx.cmd"
if (-not (Get-Command $Npx -ErrorAction SilentlyContinue)) {
  $Npx = "npx"
}

$PROJECT_ID = "lab-fileparser"
$REGION = "europe-west1"
$PROXY_SERVICE = "looker-gemini-proxy"
$NOTEBOOK_ID = "looker-weavenn"
$NOTEBOOK_URL = $env:NOTEBOOKLM_NOTEBOOK_URL
if (-not $NOTEBOOK_URL) {
  $NOTEBOOK_URL = Read-Host "URL du notebook (https://notebooklm.google.com/notebook/...)"
}

$LOCAL_PORT = 3000

function Test-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "Commande introuvable : $name"
  }
}

Test-Command "node"
if (-not (Get-Command $Npx -ErrorAction SilentlyContinue) -and -not (Get-Command "npx" -ErrorAction SilentlyContinue)) {
  Write-Error "npx introuvable — installez Node.js 18+"
}
Test-Command "cloudflared"
Test-Command "gcloud"

Write-Host "`n=== 1/4 — Vérification auth locale ===" -ForegroundColor Cyan
$authDir = Join-Path $env:USERPROFILE ".local\share\notebooklm-mcp"
if (-not (Test-Path $authDir)) {
  Write-Host "Auth non trouvée. Lancement setup-auth…" -ForegroundColor Yellow
  & $Npx -y @roomi-fields/notebooklm-mcp@latest setup-auth
}

Write-Host "`n=== 2/4 — Démarrage serveur NotebookLM (port $LOCAL_PORT) ===" -ForegroundColor Cyan
$env:NOTEBOOKLM_TRANSPORT = "http"
$env:NOTEBOOKLM_PORT = "$LOCAL_PORT"
$env:NOTEBOOKLM_UI_LOCALE = "fr"

$serverJob = Start-Job -ScriptBlock {
  param($port, $npxCmd)
  $env:NOTEBOOKLM_TRANSPORT = "http"
  $env:NOTEBOOKLM_PORT = "$port"
  $env:NOTEBOOKLM_UI_LOCALE = "fr"
  & $npxCmd -y @roomi-fields/notebooklm-mcp@latest 2>&1
} -ArgumentList $LOCAL_PORT, $Npx

Start-Sleep -Seconds 8
try {
  Invoke-RestMethod -Uri "http://localhost:$LOCAL_PORT/health" -TimeoutSec 5 | Out-Null
} catch {
  Write-Host "Le serveur met du temps à démarrer, attente 15s…" -ForegroundColor Yellow
  Start-Sleep -Seconds 15
}

Write-Host "`n=== 3/4 — Tunnel Cloudflare ===" -ForegroundColor Cyan
$tunnelJob = Start-Job -ScriptBlock {
  param($port)
  cloudflared tunnel --url "http://localhost:$port" 2>&1
} -ArgumentList $LOCAL_PORT

$tunnelUrl = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $log = Receive-Job $tunnelJob -ErrorAction SilentlyContinue | Out-String
  if ($log -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
    $tunnelUrl = $Matches[1]
    break
  }
}

if (-not $tunnelUrl) {
  Write-Error "Impossible d'obtenir l'URL du tunnel. Vérifiez cloudflared."
}

Write-Host "Tunnel public : $tunnelUrl" -ForegroundColor Green

Write-Host "`n=== Enregistrement notebook ===" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Method POST -Uri "$tunnelUrl/notebooks" -ContentType "application/json" -Body (@{
    id = $NOTEBOOK_ID
    name = "Projet Looker Weavenn"
    url = $NOTEBOOK_URL
  } | ConvertTo-Json) | Out-Null
  Invoke-RestMethod -Method PUT -Uri "$tunnelUrl/notebooks/$NOTEBOOK_ID/activate" | Out-Null
} catch {
  Write-Host "Note : enregistrement notebook (peut déjà exister)" -ForegroundColor Yellow
}

Write-Host "`n=== 4/4 — Mise à jour proxy Cloud Run ===" -ForegroundColor Cyan
gcloud config set project $PROJECT_ID --quiet
gcloud run services update $PROXY_SERVICE `
  --region $REGION `
  --update-env-vars "NOTEBOOKLM_API_URL=$tunnelUrl,NOTEBOOKLM_NOTEBOOK_ID=$NOTEBOOK_ID" `
  --quiet

$proxyUrl = gcloud run services describe $PROXY_SERVICE --region $REGION --format="value(status.url)"
Write-Host "`n✅ Prêt !" -ForegroundColor Green
Write-Host "  Proxy      : $proxyUrl"
Write-Host "  NotebookLM : $tunnelUrl"
Write-Host "  Vérif      : curl $proxyUrl/v1/notebooklm/status"
Write-Host "`nOuvrez la checklist et cliquez « Enrichir les tâches »."
Write-Host "Appuyez sur Ctrl+C pour tout arrêter.`n" -ForegroundColor Yellow

try {
  while ($true) { Start-Sleep -Seconds 60 }
} finally {
  Write-Host "`nArrêt…" -ForegroundColor Cyan
  Stop-Job $tunnelJob, $serverJob -ErrorAction SilentlyContinue
  Remove-Job $tunnelJob, $serverJob -Force -ErrorAction SilentlyContinue
}
