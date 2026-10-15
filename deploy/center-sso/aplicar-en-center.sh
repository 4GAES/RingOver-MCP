#!/bin/bash
# Añade a 4Geeks Center el inicio de sesión único que usa Ringover. Se lanza desde el Mac.
# Toca 4 ficheros de Center (2 nuevos, 2 con cambios mínimos), guarda copia de seguridad,
# prueba el módulo dentro del contenedor ANTES de activarlo y reinicia backend y frontend
# (~1 min de corte del frontend mientras recompila). Para deshacer: revertir-center.sh
set -euo pipefail
trap 'echo "✋ Se ha parado en la línea $LINENO (código $?). Si ya había pasado del paso 3, deshaz con revertir-center.sh"' ERR
HOST=${HOST:-hetzner}
SRC=${SRC:-$HOME/4GeeksCenter}
CT=/opt/controltower
STAMP=$(date +%Y%m%d-%H%M%S)
BK=$CT/_backups/sso-$STAMP
HERE="$(cd "$(dirname "$0")" && pwd)"

# Versiones de partida revisadas: si alguien las ha cambiado desde entonces, no se pisa nada.
EXPECT_MAIN=3ce2793bde91becd53d23b59ab7ae890
EXPECT_LOGIN=953207cc3b5c297efa9752a27a69c451
# (here-string: añade el salto de línea final que necesita read con set -e)
read -r M L <<<"$(ssh "$HOST" "md5sum $CT/backend/app/main.py $CT/frontend/src/app/login/page.tsx | cut -d' ' -f1 | tr '\n' ' '")"
if [ "$M" != "$EXPECT_MAIN" ] || [ "$L" != "$EXPECT_LOGIN" ]; then
  echo "✋ main.py o login/page.tsx han cambiado en el servidor desde la revisión. No aplico nada."
  exit 1
fi

echo "1/6 Copia de seguridad en $BK"
ssh "$HOST" "mkdir -p $BK && cp $CT/backend/app/main.py $BK/ && cp $CT/frontend/src/app/login/page.tsx $BK/login-page.tsx"

echo "2/6 Subiendo el módulo SSO y probándolo dentro del contenedor (aún sin activar)"
scp -q "$SRC/backend/app/api/sso.py" "$HOST:$CT/backend/app/api/sso.py"
scp -q "$HERE/probe_sso.py" "$HOST:/tmp/probe_sso.py"
OUT=$(ssh "$HOST" "docker cp /tmp/probe_sso.py controltower-backend-1:/tmp/probe_sso.py && docker exec -w /app -e PYTHONPATH=/app controltower-backend-1 python3 /tmp/probe_sso.py; docker exec controltower-backend-1 rm -f /tmp/probe_sso.py; rm -f /tmp/probe_sso.py")
echo "$OUT" | sed 's/^/    /'
if echo "$OUT" | grep -q FALLO || ! echo "$OUT" | grep -q "código de un solo uso"; then
  ssh "$HOST" "rm -f $CT/backend/app/api/sso.py"
  echo "✋ La prueba ha fallado: retirado sso.py, Center sigue como estaba."
  exit 1
fi

echo "3/6 Activando en el backend (registro del router)"
scp -q "$SRC/backend/app/main.py" "$HOST:$CT/backend/app/main.py"
ssh "$HOST" "docker restart controltower-backend-1 >/dev/null"
for _ in $(seq 1 30); do
  ssh "$HOST" "curl -fsS -o /dev/null http://127.0.0.1:8003/api/auth/sso/clients/ringover" 2>/dev/null && break
  sleep 2
done
ssh "$HOST" "curl -fsS http://127.0.0.1:8003/api/auth/sso/clients/ringover" | sed 's/^/    /'
echo

echo "4/6 Subiendo la página /sso y el login que vuelve a donde se pidió"
ssh "$HOST" "mkdir -p $CT/frontend/src/app/sso"
scp -q "$SRC/frontend/src/app/sso/page.tsx" "$HOST:$CT/frontend/src/app/sso/page.tsx"
scp -q "$SRC/frontend/src/app/login/page.tsx" "$HOST:$CT/frontend/src/app/login/page.tsx"

echo "5/6 Recompilando el frontend de Center (~1 min)"
ssh "$HOST" "docker restart controltower-frontend-1 >/dev/null"
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" https://4geekscenter.duckdns.org/sso || true)
  [ "$code" = "200" ] && break
  sleep 5
done

echo "6/6 Comprobando"
curl -s -o /dev/null -w "    /sso de Center: %{http_code}\n" https://4geekscenter.duckdns.org/sso
curl -s -o /dev/null -w "    /login de Center: %{http_code}\n" https://4geekscenter.duckdns.org/login
curl -s https://ringover.duckdns.org/api/auth/options | sed 's/^/    Ringover ve el SSO: /'
echo
echo "✅ Listo. Copia de seguridad: $BK"
