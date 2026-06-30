#!/usr/bin/env bash
# Démarre la VM NotebookLM, attend le service, met à jour le proxy Cloud Run.
# Usage (Cloud Shell) : ./scripts/notebooklm-vm-start.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lab-fileparser}"
REGION="${REGION:-europe-west1}"
ZONE="${ZONE:-europe-west1-b}"
VM_NAME="${VM_NAME:-notebooklm-mcp}"
PROXY_SERVICE="${PROXY_SERVICE:-looker-gemini-proxy}"
NOTEBOOK_ID="${NOTEBOOK_ID:-looker-weavenn}"

gcloud config set project "$PROJECT_ID" --quiet

echo "▶ Démarrage VM $VM_NAME…"
gcloud compute instances start "$VM_NAME" --zone="$ZONE" --quiet

echo "⏳ Attente boot (45s)…"
sleep 45

VM_IP=$(gcloud compute instances describe "$VM_NAME" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo "IP VM : $VM_IP"

API_URL="http://${VM_IP}:3000"

echo "⏳ Attente API NotebookLM…"
for i in $(seq 1 20); do
  if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
    echo "✓ API OK"
    break
  fi
  sleep 5
  if [ "$i" -eq 20 ]; then
    echo "✗ API inaccessible. Logs :"
    gcloud compute ssh "$VM_NAME" --zone="$ZONE" --command 'sudo docker logs notebooklm-mcp --tail 30' || true
    exit 1
  fi
done

if [ -n "${NOTEBOOK_URL:-}" ]; then
  echo "▶ Enregistrement notebook…"
  curl -sf -X POST "${API_URL}/notebooks" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${NOTEBOOK_ID}\",\"name\":\"Projet Looker Weavenn\",\"url\":\"${NOTEBOOK_URL}\"}" || true
  curl -sf -X PUT "${API_URL}/notebooks/${NOTEBOOK_ID}/activate" || true
fi

echo "▶ Mise à jour proxy Cloud Run…"
gcloud run services update "$PROXY_SERVICE" \
  --region "$REGION" \
  --update-env-vars "NOTEBOOKLM_API_URL=${API_URL},NOTEBOOKLM_NOTEBOOK_ID=${NOTEBOOK_ID}" \
  --quiet

PROXY_URL=$(gcloud run services describe "$PROXY_SERVICE" --region "$REGION" --format='value(status.url)')
echo ""
echo "✅ Session VM prête"
echo "   Proxy      : $PROXY_URL"
echo "   NotebookLM : $API_URL"
echo "   Test       : curl ${PROXY_URL}/v1/notebooklm/status"
echo ""
echo "Quand vous avez fini : ./scripts/notebooklm-vm-stop.sh"
