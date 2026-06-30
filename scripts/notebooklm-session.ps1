# Session NotebookLM locale + tunnel Cloudflare + mise a jour du proxy Cloud Run
# Usage : .\scripts\notebooklm-session.ps1
# Prerequis : notebooklm-install.ps1 + notebooklm-auth.ps1 (une fois chacun)

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
    Write-Error "Commande introuvable : $name - installez-le puis relancez."
  }
}

function Resolve-Cloudflared() {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe"
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

function Resolve-Gcloud() {
  $cmd = Get-Command gcloud -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $candidate) { return $candidate }
  return $null
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

$cloudflaredPath = Resolve-Cloudflared
if (-not $cloudflaredPath) {
  Write-Host "cloudflared introuvable. Installez-le puis relancez PowerShell :" -ForegroundColor Red
  Write-Host "  winget install Cloudflare.cloudflared" -ForegroundColor Yellow
  exit 1
}

$gcloudPath = Resolve-Gcloud
if (-not $gcloudPath) {
  Write-Host "gcloud introuvable. Installez Google Cloud SDK puis relancez PowerShell :" -ForegroundColor Red
  Write-Host "  https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
  exit 1
}

Write-Host "cloudflared : $cloudflaredPath" -ForegroundColor DarkGray
Write-Host "gcloud      : $gcloudPath" -ForegroundColor DarkGray

Write-Host ""
Write-Host "=== 1/4 - Demarrage serveur HTTP (port $LOCAL_PORT) ===" -ForegroundColor Cyan

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
      Write-Host "Serveur OK mais non authentifie. Lancez : .\scripts\notebooklm-auth.ps1" -ForegroundColor Red
      Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
      exit 1
    }
  } catch {
    Start-Sleep -Seconds 3
  }
}

if (-not $healthOk) {
  Write-Host "Serveur HTTP inaccessible sur localhost:$LOCAL_PORT" -ForegroundColor Red
  Write-Host "Verifiez que le port est libre et relancez." -ForegroundColor Yellow
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "[OK] Serveur HTTP + auth OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== 2/4 - Tunnel Cloudflare ===" -ForegroundColor Cyan
$tunnelProc = Start-Process -FilePath $cloudflaredPath `
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

Write-Host ""
Write-Host "=== 3/4 - Enregistrement notebook ===" -ForegroundColor Cyan
try {
  $body = @{
    url = $NOTEBOOK_URL
    name = "Projet Looker Weavenn"
    description = "Checklist Looker / Dataform"
    topics = @("looker", "dataform", "semantic-layer")
  } | ConvertTo-Json
  Invoke-RestMethod -Method POST -Uri "$tunnelUrl/notebooks" -ContentType "application/json" -Body $body -TimeoutSec 120 | Out-Null
  Invoke-RestMethod -Method PUT -Uri "$tunnelUrl/notebooks/$NOTEBOOK_ID/activate" -TimeoutSec 30 | Out-Null
  Write-Host "[OK] Notebook enregistre ($NOTEBOOK_ID)" -ForegroundColor Green
} catch {
  Write-Host "Note : enregistrement notebook (peut deja exister ou id different)" -ForegroundColor Yellow
  Write-Host $_.Exception.Message
}

Write-Host ""
Write-Host "=== 4/4 - Mise a jour proxy Cloud Run ===" -ForegroundColor Cyan
& $gcloudPath config set project $PROJECT_ID --quiet
& $gcloudPath run services update $PROXY_SERVICE `
  --region $REGION `
  --update-env-vars "NOTEBOOKLM_API_URL=$tunnelUrl,NOTEBOOKLM_NOTEBOOK_ID=$NOTEBOOK_ID" `
  --quiet

$proxyUrl = & $gcloudPath run services describe $PROXY_SERVICE --region $REGION --format="value(status.url)"
Write-Host ""
Write-Host "PRET !" -ForegroundColor Green
Write-Host "  Proxy      : $proxyUrl"
Write-Host "  NotebookLM : $tunnelUrl"
Write-Host "  Test       : curl $proxyUrl/v1/notebooklm/status"
Write-Host ""
Write-Host "Ouvrez la checklist, Ctrl+F5, puis Enrichir les taches"
Write-Host "Ctrl+C ici pour arreter tunnel + serveur" -ForegroundColor Yellow
Write-Host ""

try {
  while ($true) { Start-Sleep -Seconds 30 }
} finally {
  Write-Host ""
  Write-Host "Arret..." -ForegroundColor Cyan
  Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
