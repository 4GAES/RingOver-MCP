#!/bin/bash
# Copia la clave de Ringover guardada (cifrada) en ControlTower al .env de esta app,
# sin mostrarla nunca. Se ejecuta en el servidor. Úsalo también si rotáis la clave.
set -euo pipefail
ENV=/opt/ringover/.env
K=$(docker exec -i controltower-backend-1 python3 - <<'PY'
import asyncio
from app.core.database import AsyncSessionLocal
from app.api.settings import get_decrypted_setting
async def m():
    async with AsyncSessionLocal() as db:
        v = await get_decrypted_setting("ringover_api_key", db)
        print(v or "", end="")
asyncio.run(m())
PY
)
[ -n "$K" ] || { echo "ControlTower no tiene clave de Ringover"; exit 1; }
umask 077
touch "$ENV"
grep -v '^RINGOVER_API_KEY=' "$ENV" > "$ENV.tmp" || true
printf 'RINGOVER_API_KEY=%s\n' "$K" >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"
chmod 600 "$ENV"
echo "Clave importada en $ENV (${#K} caracteres)"
