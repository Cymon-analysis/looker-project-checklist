# Session NotebookLM locale + tunnel Cloudflare + mise à jour du proxy Cloud Run
# Usage : .\scripts\notebooklm-session.ps1
# Prérequis : notebooklm-install.ps1 + notebooklm-auth.ps1 (une fois chacun)

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:USERPROFILE "notebooklm-mcp"
$PROJECT_ID = "lab-fileparser"
$REGION = "europe-west1"
$PROXY_SERVICE = "looker-gemini-proxy"
$NOTEBOOK_ID = "looker-weavenn"
$LOCAL_PORT = 3000

$NOTEBOOK_URL = $env:NOTEBOOKLM_NOTEBOOK_URL
if (-not $NOTEBOOK_URL) {
  $NOTEBOOK_URL = Read-Host "URL du notebook (https://notebooklm.google.com/notebook/...)"
}

function Test-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "Commande introuvable : $name — installez-le puis relancez."
  }
}

if (-not (Test-Path (Join-Path $InstallDir "dist\http-wrapper.js"))) {
  Write-Host "Installation requise. Lancez : .\scripts\notebooklm-install.ps1" -ForegroundColor Red
  exit 1
}

$authFile = Join-Path $env:LOCALAPPDATA "notebooklm-mcp\Data\browser_state\state.json"
if (-not (Test-Path $authFile)) {
  Write-Host "Auth requise. Lancez : .\scripts\notebooklm-auth.ps1" -ForegroundColor Red
  exit 1
}

Test-Command "cloudflared"
Test-Command "gcloud"

Write-Host "`n=== 1/4 — Démarrage serveur HTTP (port $LOCAL_PORT) ===" -ForegroundColor Cyan

# Tuer un ancien process sur le port 3000 si présent
Get-NetTCPConnection -LocalPort $LOCAL_PORT -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$serverProc = Start-Process -FilePath "npm.cmd" `
  -ArgumentList "run", "start:http" `
  -WorkingDirectory $InstallDir `
  -PassThru `
  -WindowStyle Minimized

Start-Sleep -Seconds 10
$healthOk = $false
for ($i = 0; $i -lt 12; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:$LOCAL_PORT/health" -TimeoutSec 5
    if ($health.success -and $health.data.authenticated) {
      $healthOk = $true
      break
    }
    if ($health.success -and -not $health.data.authenticated) {
      Write-Host "Serveur OK mais non authentifié. Lancez : .\scripts\notebooklm-auth.ps1" -ForegroundColor Red
      Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
      exit 1
    }
  } catch {
    Start-Sleep -Seconds 3
  }
}

if (-not $healthOk) {
  Write-Host "Serveur HTTP inaccessible sur localhost:$LOCAL_PORT" -ForegroundColor Red
  Write-Host "Vérifiez que le port est libre et relancez." -ForegroundColor Yellow
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "✓ Serveur HTTP + auth OK" -ForegroundColor Green

Write-Host "`n=== 2/4 — Tunnel Cloudflare ===" -ForegroundColor Cyan
$tunnelProc = Start-Process -FilePath "cloudflared" `
  -ArgumentList "tunnel", "--url", "http://localhost:$LOCAL_PORT" `
  -RedirectStandardOutput "$env:TEMP\cloudflared-nblm.log" `
  -RedirectStandardError "$env:TEMP\cloudflared-nblm.err.log" `
  -PassThru `
  -WindowStyle Minimized

$tunnelUrl = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 2
  $log = ""
  if (Test-Path "$env:TEMP\cloudflared-nblm.log") {
    $log += Get-Content "$env:TEMP\cloudflared-nblm.log" -Raw -ErrorAction SilentlyContinue
  }
  if (Test-Path "$env:TEMP\cloudflared-nblm.err.log") {
    $log += Get-Content "$env:TEMP\cloudflared-nblm.err.log" -Raw -ErrorAction SilentlyContinue
  }
  if ($log -match "(https://[a-z0-9-]+\.trycloudflare\.com)") {
    $tunnelUrl = $Matches[1]
    break
  }
}

if (-not $tunnelUrl) {
  Write-Host "Tunnel introuvable. Installez cloudflared : winget install Cloudflare.cloudflared" -ForegroundColor Red
  Stop-Process -Id $serverProc.Id, $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "Tunnel : $tunnelUrl" -ForegroundColor Green

Write-Host "`n=== 3/4 — Enregistrement notebook ===" -ForegroundColor Cyan
try {
  $body = @{
    url = $NOTEBOOK_URL
    name = "Projet Looker Weavenn"
    description = "Checklist Looker / Dataform"
    topics = @("looker", "dataform", "semantic-layer")
  } | ConvertTo-Json
  Invoke-RestMethod -Method POST -Uri "$tunnelUrl/notebooks" -ContentType "application/json" -Body $body -TimeoutSec 120 | Out-Null
  Invoke-RestMethod -Method PUT -Uri "$tunnelUrl/notebooks/$NOTEBOOK_ID/activate" -TimeoutSec 30 | Out-Null
  Write-Host "✓ Notebook enregistré ($NOTEBOOK_ID)" -ForegroundColor Green
} catch {
  Write-Host "Note : enregistrement notebook (peut déjà exister ou id différent)" -ForegroundColor Yellow
  Write-Host $_.Exception.Message
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
Write-Host "  Test       : curl $proxyUrl/v1/notebooklm/status"
Write-Host "`n→ Ouvrez la checklist, Ctrl+F5, puis « Enrichir les tâches »"
Write-Host "→ Ctrl+C ici pour arrêter tunnel + serveur`n" -ForegroundColor Yellow

try {
  while ($true) { Start-Sleep -Seconds 30 }
} finally {
  Write-Host "`nArrêt…" -ForegroundColor Cyan
  Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
