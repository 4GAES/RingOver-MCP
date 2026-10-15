#!/bin/bash
# Deshace aplicar-en-center.sh con la copia de seguridad más reciente.
set -euo pipefail
HOST=${HOST:-hetzner}
CT=/opt/controltower
BK=$(ssh "$HOST" "ls -d $CT/_backups/sso-* | tail -1")
echo "Restaurando desde $BK"
ssh "$HOST" "cp $BK/main.py $CT/backend/app/main.py && cp $BK/login-page.tsx $CT/frontend/src/app/login/page.tsx && \
  rm -f $CT/backend/app/api/sso.py && rm -rf $CT/frontend/src/app/sso && \
  docker restart controltower-backend-1 controltower-frontend-1 >/dev/null"
echo "Hecho. El frontend de Center tarda ~1 min en volver."
