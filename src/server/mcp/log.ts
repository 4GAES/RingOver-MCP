import type { McpCallItem, McpCallStatus, McpUsage } from "../../shared/api";
import { addDays, DAY_MS, dayList, localDay, localToUtc } from "../../shared/time";
import type { DB } from "../db";

// Registro de cada uso del MCP: quién, desde qué app, qué herramienta, con qué
// argumentos, cuánto tardó, cuánto devolvió y si falló. Alimenta "Actividad" y "Consumo".

export interface CallRecord {
  tsMs: number;
  tokenId: string | null;
  ownerEmail: string | null;
  client: string | null;
  method: string;
  tool?: string | null;
  args?: unknown;
  status: McpCallStatus;
  error?: string | null;
  durationMs?: number;
  bytes?: number;
  ip?: string | null;
}

/** Aproximación habitual: ~4 caracteres por token de contexto del modelo. */
export const approxTokens = (bytes: number) => Math.round(bytes / 4);

const SECRET_KEYS = /token|secret|password|authorization/i;

/** Argumentos para el registro: sin nada que parezca un secreto y recortados a 2 KB. */
function safeArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  const json = JSON.stringify(args, (k, v) => (SECRET_KEYS.test(k) ? "***" : v));
  return json.length > 2000 ? `${json.slice(0, 2000)}…` : json;
}

export class McpLog {
  private minute = new Map<string, number[]>();

  constructor(
    private readonly db: DB,
    readonly limits: { perMin: number; perDay: number },
  ) {}

  record(r: CallRecord) {
    this.db
      .prepare(
        `INSERT INTO mcp_calls (ts_ms, token_id, owner_email, client, method, tool, args, status, error, duration_ms, bytes_out, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.tsMs,
        r.tokenId,
        r.ownerEmail,
        r.client ? r.client.slice(0, 120) : null,
        r.method,
        r.tool ?? null,
        safeArgs(r.args),
        r.status,
        r.error ? r.error.slice(0, 500) : null,
        Math.round(r.durationMs ?? 0),
        r.bytes ?? 0,
        r.ip ?? null,
      );
  }

  /**
   * Límite de uso por token: por minuto (en memoria) y por día (en la base, así
   * sobrevive a reinicios). Devuelve el motivo si se ha pasado.
   */
  checkLimit(tokenId: string, now = Date.now()): string | null {
    const recent = (this.minute.get(tokenId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.limits.perMin) {
      this.minute.set(tokenId, recent);
      return `Límite de ${this.limits.perMin} peticiones por minuto. Espera un momento.`;
    }
    const today = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM mcp_calls WHERE token_id = ? AND ts_ms >= ? AND method = 'tools/call'",
      )
      .get(tokenId, localToUtc(localDay(now))) as { n: number };
    if (Number(today.n) >= this.limits.perDay) {
      return `Límite de ${this.limits.perDay} consultas al día para este token. Se reinicia a medianoche.`;
    }
    recent.push(now);
    this.minute.set(tokenId, recent);
    return null;
  }

  list(f: {
    ownerEmail?: string;
    tokenId?: string;
    tool?: string;
    status?: string;
    cursor?: string | null;
    limit?: number;
  }): { items: McpCallItem[]; next: string | null } {
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    if (f.ownerEmail) {
      where.push("m.owner_email = ?");
      params.push(f.ownerEmail.toLowerCase());
    }
    if (f.tokenId) {
      where.push("m.token_id = ?");
      params.push(f.tokenId);
    }
    if (f.tool) {
      where.push("m.tool = ?");
      params.push(f.tool);
    }
    if (f.status) {
      where.push("m.status = ?");
      params.push(f.status);
    }
    if (f.cursor) {
      // Cursor "ts:id": orden por hora real y, a igualdad, por id.
      const [ts, id] = f.cursor.split(":").map(Number);
      if (Number.isFinite(ts) && Number.isFinite(id)) {
        where.push("(m.ts_ms < ? OR (m.ts_ms = ? AND m.id < ?))");
        params.push(ts as number, ts as number, id as number);
      }
    }
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(
        `SELECT m.*, COALESCE(t.name, CASE WHEN m.token_id = 'config' THEN 'Token de configuración (heredado)' END) AS token_name
         FROM mcp_calls m LEFT JOIN api_tokens t ON t.id = m.token_id
         WHERE ${where.join(" AND ")} AND m.method != 'initialize'
         ORDER BY m.ts_ms DESC, m.id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as unknown as {
      id: number;
      ts_ms: number;
      token_id: string | null;
      token_name: string | null;
      owner_email: string | null;
      client: string | null;
      method: string;
      tool: string | null;
      args: string | null;
      status: McpCallStatus;
      error: string | null;
      duration_ms: number;
      bytes_out: number;
    }[];
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        tsMs: r.ts_ms,
        tokenId: r.token_id,
        tokenName: r.token_name,
        ownerEmail: r.owner_email,
        client: r.client,
        method: r.method,
        tool: r.tool,
        args: r.args,
        status: r.status,
        error: r.error,
        durationMs: r.duration_ms,
        bytes: r.bytes_out,
      })),
      next: rows.length > limit && page.at(-1) ? `${page.at(-1)?.ts_ms}:${page.at(-1)?.id}` : null,
    };
  }

  usage(from: string, to: string, ownerEmail?: string): McpUsage {
    const start = localToUtc(from);
    const end = localToUtc(addDays(to, 1));
    const scope = ownerEmail ? "AND owner_email = ?" : "";
    const p = (extra: (string | number)[] = []) => [
      start,
      end,
      ...(ownerEmail ? [ownerEmail.toLowerCase()] : []),
      ...extra,
    ];
    const base = `FROM mcp_calls WHERE ts_ms >= ? AND ts_ms < ? ${scope}`;

    const t = this.db
      .prepare(
        `SELECT SUM(method = 'tools/call' AND status IN ('ok','error')) AS calls,
                SUM(method = 'tools/call' AND status = 'error') AS errors,
                SUM(status IN ('denied','rate_limited')) AS blocked,
                AVG(CASE WHEN method = 'tools/call' THEN duration_ms END) AS avg_ms,
                SUM(CASE WHEN method = 'tools/call' THEN bytes_out ELSE 0 END) AS bytes,
                COUNT(DISTINCT CASE WHEN method = 'tools/call' THEN owner_email END) AS people,
                COUNT(DISTINCT CASE WHEN method = 'tools/call' THEN token_id END) AS connections
         ${base}`,
      )
      .get(...p()) as Record<string, number | null>;

    const durations = (
      this.db
        .prepare(`SELECT duration_ms AS d ${base} AND method = 'tools/call' ORDER BY duration_ms`)
        .all(...p()) as {
        d: number;
      }[]
    ).map((r) => r.d);
    const p95 = durations.length
      ? (durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0)
      : 0;

    // Serie diaria en hora de Madrid (se agrupa en JS: el día local no es un corte UTC).
    const perDay = new Map<string, { ok: number; error: number }>();
    for (const r of this.db
      .prepare(`SELECT ts_ms, status ${base} AND method = 'tools/call' AND status IN ('ok','error')`)
      .all(...p()) as { ts_ms: number; status: string }[]) {
      const d = localDay(r.ts_ms);
      const v = perDay.get(d) ?? { ok: 0, error: 0 };
      if (r.status === "ok") v.ok++;
      else v.error++;
      perDay.set(d, v);
    }

    const byTool = (
      this.db
        .prepare(
          `SELECT tool, COUNT(*) AS calls, SUM(status = 'error') AS errors, AVG(duration_ms) AS avg_ms, SUM(bytes_out) AS bytes
           ${base} AND method = 'tools/call' AND tool IS NOT NULL GROUP BY tool ORDER BY calls DESC`,
        )
        .all(...p()) as { tool: string; calls: number; errors: number; avg_ms: number; bytes: number }[]
    ).map((r) => ({
      tool: r.tool,
      calls: Number(r.calls),
      errors: Number(r.errors),
      avgMs: Math.round(Number(r.avg_ms)),
      approxTokens: approxTokens(Number(r.bytes)),
    }));

    const byPerson = (
      this.db
        .prepare(
          `SELECT owner_email AS email, COUNT(*) AS calls, SUM(status = 'error') AS errors, SUM(bytes_out) AS bytes, MAX(ts_ms) AS last
           ${base} AND method = 'tools/call' AND owner_email IS NOT NULL GROUP BY owner_email ORDER BY calls DESC`,
        )
        .all(...p()) as { email: string; calls: number; errors: number; bytes: number; last: number }[]
    ).map((r) => ({
      email: r.email,
      calls: Number(r.calls),
      errors: Number(r.errors),
      approxTokens: approxTokens(Number(r.bytes)),
      lastMs: Number(r.last),
    }));

    const byClient = (
      this.db
        .prepare(
          `SELECT COALESCE(client, 'Desconocido') AS client, COUNT(*) AS calls ${base} AND method = 'tools/call'
           GROUP BY 1 ORDER BY calls DESC LIMIT 8`,
        )
        .all(...p()) as { client: string; calls: number }[]
    ).map((r) => ({ client: r.client, calls: Number(r.calls) }));

    const bytes = Number(t.bytes ?? 0);
    return {
      from,
      to,
      totals: {
        calls: Number(t.calls ?? 0),
        errors: Number(t.errors ?? 0),
        blocked: Number(t.blocked ?? 0),
        avgMs: Math.round(Number(t.avg_ms ?? 0)),
        p95Ms: p95,
        bytes,
        approxTokens: approxTokens(bytes),
        people: Number(t.people ?? 0),
        connections: Number(t.connections ?? 0),
      },
      series: dayList(from, to).map((d) => ({ day: d, ...(perDay.get(d) ?? { ok: 0, error: 0 }) })),
      byTool,
      byPerson,
      byClient,
      limits: this.limits,
    };
  }

  /** Se guarda medio año de registro. */
  prune(now = Date.now()) {
    this.db.prepare("DELETE FROM mcp_calls WHERE ts_ms < ?").run(now - 180 * DAY_MS);
  }
}
