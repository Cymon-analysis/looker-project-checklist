#!/usr/bin/env bash
# Arrête la VM NotebookLM (plus de facturation compute).
# Usage (Cloud Shell) : ./scripts/notebooklm-vm-stop.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lab-fileparser}"
ZONE="${ZONE:-europe-west1-b}"
VM_NAME="${VM_NAME:-notebooklm-mcp}"

gcloud config set project "$PROJECT_ID" --quiet

echo "■ Arrêt VM $VM_NAME…"
gcloud compute instances stop "$VM_NAME" --zone="$ZONE" --quiet

echo "✅ VM arrêtée. Disque conservé (~2 €/mois)."
echo "   Relancer une session : ./scripts/notebooklm-vm-start.sh"
