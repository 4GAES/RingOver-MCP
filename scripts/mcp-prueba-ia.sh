#!/bin/bash
# Prueba con IA real: Claude responde 6 preguntas usando SOLO el MCP de Ringover y se
# muestra qué herramientas eligió, si alguna falló y qué contestó.
# Requisito: sesión iniciada en Claude Code (si falla la autenticación: claude /login).
# Uso: scripts/mcp-prueba-ia.sh [url]   (el token se lee de .env.mcp)
set -euo pipefail
cd "$(dirname "$0")/.."
URL=${1:-https://ringover.duckdns.org/mcp}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
umask 077
python3 - "$TMP/mcp.json" "$URL" <<'PY'
import json, sys
tok = open(".env.mcp").read().strip()
json.dump({"mcpServers": {"ringover": {"type": "http", "url": sys.argv[2], "headers": {"Authorization": f"Bearer {tok}"}}}}, open(sys.argv[1], "w"))
PY
i=0
while IFS= read -r q; do
  i=$((i+1))
  echo "… pregunta $i: $q"
  claude -p "$q Responde en español, breve, con cifras concretas." \
    --mcp-config "$TMP/mcp.json" --strict-mcp-config --allowedTools "mcp__ringover" \
    --disallowedTools "Bash,Read,Write,Edit,WebFetch,WebSearch,Glob,Grep,Task,Agent" \
    --model sonnet --output-format stream-json --verbose > "$TMP/r$i.jsonl" 2>/dev/null || true
done <<'QS'
¿Cómo le fue ayer al equipo de llamadas? Dame las cifras clave.
¿Qué leads calientes llevan más de 3 días sin que nadie los llame? Dame los 3 primeros.
¿Quién ha tenido más conversaciones de más de 15 minutos esta semana?
¿A qué hora del día contesta más la gente cuando les llamamos?
Compara a Pablo Han y a Sebastián Guzmán durante el mes pasado.
¿Hay algo raro hoy en el equipo? ¿Alguien conectado sin llamar?
QS
python3 - "$TMP" <<'PY'
import json, sys, glob, os
for f in sorted(glob.glob(os.path.join(sys.argv[1], "r*.jsonl")), key=lambda x: int(x.split("r")[-1].split(".")[0])):
    tools, errors, final, meta = [], 0, "", {}
    for line in open(f):
        try: ev = json.loads(line)
        except Exception: continue
        if ev.get("type") == "assistant":
            for c in ev["message"].get("content", []):
                if c.get("type") == "tool_use":
                    tools.append(f'{c["name"].replace("mcp__ringover__", "")}({json.dumps(c.get("input", {}), ensure_ascii=False)})')
        if ev.get("type") == "user":
            for c in ev["message"].get("content", []):
                if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("is_error"): errors += 1
        if ev.get("type") == "result":
            final = ev.get("result", ""); meta = {"turnos": ev.get("num_turns"), "s": round(ev.get("duration_ms", 0) / 1000)}
    print(f"\n━━ {os.path.basename(f)} · {meta.get('turnos')} turnos · {meta.get('s')} s")
    print("  herramientas:", " → ".join(tools) or "NINGUNA", f"| errores: {errors}")
    print("  respuesta:", final.replace("\n", " ")[:600])
PY
