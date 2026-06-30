# Auth Google NotebookLM (une fois) — ouvre Chrome
# Usage : .\scripts\notebooklm-auth.ps1

$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:USERPROFILE "notebooklm-mcp"

if (-not (Test-Path (Join-Path $InstallDir "dist\http-wrapper.js"))) {
  Write-Host "Installation requise. Lancez d'abord : .\scripts\notebooklm-install.ps1" -ForegroundColor Red
  exit 1
}

Write-Host "=== Auth Google NotebookLM ===" -ForegroundColor Cyan
Write-Host "Chrome va s'ouvrir. Connectez-vous avec @converteo.com, ouvrez notebooklm.google.com, puis fermez Chrome.`n"

$chromium = Join-Path $env:LOCALAPPDATA "ms-playwright\chromium-1194\chrome-win\chrome.exe"
if (-not (Test-Path $chromium)) {
  Write-Host "Chromium Patchright manquant — téléchargement (~150 Mo)…" -ForegroundColor Yellow
  Push-Location $InstallDir
  try {
    node node_modules\patchright\cli.js install chromium
  } finally {
    Pop-Location
  }
}

Push-Location $InstallDir
try {
  npm run setup-auth
} finally {
  Pop-Location
}

$authFile = Join-Path $env:LOCALAPPDATA "notebooklm-mcp\Data\browser_state\state.json"
if (Test-Path $authFile) {
  Write-Host "`n✅ Auth enregistrée : $authFile" -ForegroundColor Green
} else {
  Write-Host "`n⚠️ Fichier auth non trouvé. Relancez setup-auth." -ForegroundColor Yellow
}
