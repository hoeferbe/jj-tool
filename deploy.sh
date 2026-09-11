#!/usr/bin/env bash
# Baut die jj-tool Container (app + api) neu und startet sie neu.
set -euo pipefail

COMPOSE_DIR="/media/docker/jj-tool"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose-Datei nicht gefunden: $COMPOSE_FILE" >&2
  exit 1
fi

echo "==> Baue Images neu (app + api)"
docker compose -f "$COMPOSE_FILE" build

echo "==> Starte Container neu"
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Status"
docker compose -f "$COMPOSE_FILE" ps

echo "==> Reloade nginx (Reverse Proxy DNS-Cache invalidieren)"
if docker exec nginx nginx -t; then
  docker exec nginx nginx -s reload
else
  echo "nginx-Konfiguration ungueltig, Reload uebersprungen" >&2
  exit 1
fi
