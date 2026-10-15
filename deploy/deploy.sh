#!/bin/bash
# Despliegue desde el Mac: compila, sube y recarga en Hetzner (acceso por Tailscale).
#   deploy/deploy.sh            → despliegue normal
#   deploy/deploy.sh --primera  → además crea .env, nginx y el proceso PM2
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${HOST:-hetzner}
DIR=/opt/ringover

npm run check
NODE_ENV=production npm run build

rsync -az --delete \
  --exclude node_modules --exclude data --exclude .env --exclude .env.secret \
  dist package.json package-lock.json deploy "$HOST:$DIR/"

ssh "$HOST" "cd $DIR && npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null"

if [ "${1:-}" = "--primera" ]; then
  [ -f .env.mcp ] || node -e 'process.stdout.write(require("crypto").randomBytes(36).toString("base64url"))' > .env.mcp
  chmod 600 .env.mcp
  ssh "$HOST" "umask 077; cat > $DIR/.env.base" <<ENV
NODE_ENV=production
PORT=3020
HOST=127.0.0.1
DB_PATH=$DIR/data/ringover.db
STATIC_DIR=$DIR/dist/web
CENTER_URL=http://127.0.0.1:8003
CENTER_CALLS_SLUG=admisiones-contactabilidad
COOKIE_SECURE=true
SYNC_ENABLED=true
MCP_TOKEN=$(cat .env.mcp)
ENV
  ssh "$HOST" "cd $DIR && grep -h '^RINGOVER_API_KEY=' .env .env.secret 2>/dev/null | head -1 > .env.key || true; \
    cat .env.base .env.key > .env && rm -f .env.base .env.key .env.secret && chmod 600 .env && \
    { grep -q '^RINGOVER_API_KEY=.' .env || bash deploy/importar-clave.sh; } && \
    cp deploy/nginx-ringover.conf /etc/nginx/sites-available/ringover.duckdns.org && \
    ln -sf /etc/nginx/sites-available/ringover.duckdns.org /etc/nginx/sites-enabled/ringover.duckdns.org && \
    nginx -t && systemctl reload nginx && \
    pm2 start deploy/ecosystem.config.cjs && pm2 save"
else
  ssh "$HOST" "cd $DIR && pm2 reload ringover --update-env && pm2 save >/dev/null"
fi

sleep 2
ssh "$HOST" "curl -fsS http://127.0.0.1:3020/healthz" && echo && echo "Desplegado."
