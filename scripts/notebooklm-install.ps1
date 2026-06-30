# Installe NotebookLM MCP en local (une fois) - requis pour auth + mode HTTP
# Usage : .\scripts\notebooklm-install.ps1

$ErrorActionPreference = "Stop"
$InstallDir = Join-Path $env:USERPROFILE "notebooklm-mcp"

function Test-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "Commande introuvable : $name"
  }
}

Test-Command "git"
Test-Command "npm"

if (-not (Test-Path $InstallDir)) {
  Write-Host "Clonage dans $InstallDir ..." -ForegroundColor Cyan
  git clone --depth 1 https://github.com/roomi-fields/notebooklm-mcp.git $InstallDir
} else {
  Write-Host "Dossier deja present : $InstallDir" -ForegroundColor Yellow
}

Push-Location $InstallDir
try {
  Write-Host "Installation des dependances (2-5 min)..." -ForegroundColor Cyan
  npm install
  Write-Host "Compilation..." -ForegroundColor Cyan
  npm run build
  Write-Host "Telechargement Chromium Patchright v1194 (~150 Mo)..." -ForegroundColor Cyan
  node node_modules\patchright\cli.js install chromium
  Write-Host ""
  Write-Host "OK - Installation terminee." -ForegroundColor Green
  Write-Host "Prochaine etape : .\scripts\notebooklm-auth.ps1" -ForegroundColor Green
} finally {
  Pop-Location
}
