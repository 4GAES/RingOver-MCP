import type {
  AgentDetail,
  AgentOption,
  AgentRef,
  AgentRow,
  CallItem,
  CallsPage,
  DataStatus,
  DurationBucket,
  HourPoint,
  LiveState,
  LiveTeam,
  NumberHistory,
  Overview,
  SeriesPoint,
  Timeline,
} from "../../shared/api";
import { contactKey } from "../../shared/format";
import { CORTA_S, emptyMetrics, LARGA_S, type Metrics } from "../../shared/metrics";
import { addDays, dayList, localDay, localToUtc, startOfWeek } from "../../shared/time";
import { type DB, getState } from "../db";
import { connectedSeconds } from "../sync/presence";
import { type ComparePeriod, comparePeriod, type Period, resolvePeriod } from "./period";

/** user_id para las llamadas sin comercial (entrantes perdidas en centralita). */
export const UNASSIGNED = 0;

const AGG = `
  COUNT(*) AS llamadas,
  COALESCE(SUM(is_answered), 0) AS contestadas,
  COALESCE(SUM(is_new), 0) AS nuevas,
  COALESCE(SUM(1 - is_new), 0) AS antiguas,
  COALESCE(SUM(incall_s), 0) AS tiempo_llamada,
  COALESCE(SUM(total_s), 0) AS tiempo_telefono,
  COALESCE(SUM(is_answered AND incall_s >= ${LARGA_S}), 0) AS mas15,
  COALESCE(SUM(is_answered AND incall_s < ${CORTA_S}), 0) AS menos5,
  COALESCE(SUM(is_new AND is_answered AND incall_s >= ${LARGA_S}), 0) AS nuevas_mas15,
  COALESCE(SUM(direction = 'out'), 0) AS salientes,
  COALESCE(SUM(direction = 'in'), 0) AS entrantes,
  COALESCE(SUM(direction = 'in' AND is_answered = 0), 0) AS perdidas`;

type AggRow = Omit<Metrics, "tiempo_conectado" | "tiempo_disponible"> & { k?: string | number | null };

/** A quién se mira: un comercial, una selección de varios o (sin valor) todo el equipo. */
export type Who = number | readonly number[] | undefined;

const whoIds = (who: Who): number[] | null =>
  who === undefined ? null : typeof who === "number" ? [who] : [...new Set(who)];

/** Condición SQL sobre user_id (UNASSIGNED son las llamadas sin comercial, user_id NULL). */
export function userWhere(who: Who, col = "user_id"): { sql: string; params: number[] } | null {
  const ids = whoIds(who);
  if (!ids) return null;
  const real = ids.filter((i) => i !== UNASSIGNED);
  const parts: string[] = [];
  if (real.length)
    parts.push(real.length === 1 ? `${col} = ?` : `${col} IN (${real.map(() => "?").join(",")})`);
  if (ids.includes(UNASSIGNED)) parts.push(`${col} IS NULL`);
  if (!parts.length) return { sql: "0", params: [] };
  return { sql: parts.length > 1 ? `(${parts.join(" OR ")})` : (parts[0] as string), params: real };
}

function aggregate(
  db: DB,
  startMs: number,
  endMs: number,
  opts: { who?: Who; groupBy?: "user" | "day" | "hour" } = {},
): AggRow[] {
  const where = ["internal = 0", "start_ms >= ?", "start_ms < ?"];
  const params: (number | string)[] = [startMs, endMs];
  const u = userWhere(opts.who);
  if (u) {
    where.push(u.sql);
    params.push(...u.params);
  }
  const key =
    opts.groupBy === "user"
      ? `COALESCE(user_id, ${UNASSIGNED})`
      : opts.groupBy === "day"
        ? "day"
        : opts.groupBy === "hour"
          ? "hour"
          : null;
  const sql = `SELECT ${key ? `${key} AS k,` : ""} ${AGG} FROM calls WHERE ${where.join(" AND ")} ${
    key ? `GROUP BY ${key}` : ""
  }`;
  return db.prepare(sql).all(...params) as unknown as AggRow[];
}

const toMetrics = (
  r: AggRow | undefined,
  conectado: { connected: number; available: number } | null,
): Metrics => {
  const m = emptyMetrics(conectado ? Math.round(conectado.connected) : null);
  if (conectado) m.tiempo_disponible = Math.round(conectado.available);
  if (!r) return m;
  for (const k of Object.keys(m) as (keyof Metrics)[]) {
    if (k === "tiempo_conectado" || k === "tiempo_disponible") continue;
    m[k] = Number(r[k as keyof AggRow] ?? 0);
  }
  return m;
};

/** Desde cuándo medimos la conexión a Ringover; antes de eso no hay dato (null). */
function presenceSince(db: DB): number | null {
  const v = getState(db, "presence_since_ms");
  return v ? Number(v) : null;
}

function presenceTotal(
  db: DB,
  startMs: number,
  endMs: number,
  who?: Who,
): { connected: number; available: number } | null {
  const since = presenceSince(db);
  if (since === null || endMs <= since) return null;
  const map = connectedSeconds(db, startMs, endMs, who);
  const t = { connected: 0, available: 0 };
  for (const v of map.values()) {
    t.connected += v.connected;
    t.available += v.available;
  }
  return t;
}

export function agentRefs(db: DB): Map<number, AgentRef> {
  const rows = db.prepare("SELECT user_id, name, initials, color, email FROM agents").all() as unknown as {
    user_id: number;
    name: string;
    initials: string | null;
    color: string | null;
    email: string | null;
  }[];
  const map = new Map<number, AgentRef>();
  for (const r of rows) {
    map.set(r.user_id, {
      id: r.user_id,
      name: r.name,
      initials: r.initials ?? "?",
      color: r.color,
      email: r.email,
    });
  }
  map.set(UNASSIGNED, { id: UNASSIGNED, name: "Sin asignar", initials: "—", color: null, email: null });
  return map;
}

const refFor = (refs: Map<number, AgentRef>, id: number): AgentRef =>
  refs.get(id) ?? { id, name: `Usuario ${id}`, initials: "?", color: null, email: null };

export function liveStates(db: DB, now = Date.now()): Map<number, LiveState> {
  const rows = db
    .prepare("SELECT user_id, connected, in_call, snoozed, seen_ms, state_since_ms FROM presence_now")
    .all() as unknown as {
    user_id: number;
    connected: number;
    in_call: number;
    snoozed: number;
    seen_ms: number;
    state_since_ms: number;
  }[];
  const map = new Map<number, LiveState>();
  for (const r of rows) {
    map.set(r.user_id, {
      connected: !!r.connected,
      inCall: !!r.in_call,
      snoozed: !!r.snoozed,
      sinceMs: r.state_since_ms,
      seenMs: r.seen_ms,
      fresh: now - r.seen_ms < 5 * 60_000,
    });
  }
  return map;
}

export function dataStatus(
  db: DB,
  extra: { backfillRunning?: boolean; lastError?: string | null } = {},
): DataStatus {
  const num = (k: string) => {
    const v = getState(db, k);
    return v ? Number(v) : null;
  };
  return {
    callsSyncedMs: num("calls_synced_ms"),
    presenceSyncedMs: num("presence_synced_ms"),
    presenceStatus:
      (getState(db, "presence_status") as DataStatus["presenceStatus"]) ??
      (num("presence_since_ms") ? "ok" : "pendiente"),
    presenceSinceMs: num("presence_since_ms"),
    historyFromMs: num("history_from_ms"),
    backfillRunning: extra.backfillRunning ?? false,
    lastError: extra.lastError ?? null,
  };
}

/** Serie diaria (o semanal si el rango es largo) para minigráficos y evolución. */
function series(db: DB, p: Period, who?: Who, now = Date.now()): Overview["series"] {
  const from = p.days === 1 ? addDays(p.to, -13) : p.from;
  const days = dayList(from, p.to);
  const startMs = localToUtc(from);
  const endMs = p.endMs;
  const byDay = new Map<string, AggRow>();
  for (const r of aggregate(db, startMs, endMs, { who, groupBy: "day" })) byDay.set(String(r.k), r);

  const since = presenceSince(db);
  const dayPoint = (day: string): SeriesPoint => {
    const s = localToUtc(day);
    const e = Math.min(localToUtc(addDays(day, 1)), now);
    const pres = since !== null && e > since ? presenceTotal(db, s, e, who) : null;
    return { day, m: toMetrics(byDay.get(day), pres) };
  };

  if (days.length <= 62) return { granularity: "day", points: days.map(dayPoint) };

  // Agrupado por semanas (lunes).
  const weeks = new Map<string, SeriesPoint>();
  for (const day of days) {
    const wk = startOfWeek(day);
    const pt = dayPoint(day);
    const acc = weeks.get(wk);
    if (!acc) {
      weeks.set(wk, { day: wk, m: { ...pt.m } });
      continue;
    }
    const m = acc.m as unknown as Record<string, number | null>;
    const add = pt.m as unknown as Record<string, number | null>;
    for (const k of Object.keys(m)) {
      const a = m[k] ?? null;
      const b = add[k] ?? null;
      m[k] = a === null && b === null ? null : (a ?? 0) + (b ?? 0);
    }
  }
  return { granularity: "week", points: [...weeks.values()] };
}

function hours(db: DB, startMs: number, endMs: number, who?: Who): HourPoint[] {
  const where = ["internal = 0", "start_ms >= ?", "start_ms < ?"];
  const params: number[] = [startMs, endMs];
  const u = userWhere(who);
  if (u) {
    where.push(u.sql);
    params.push(...u.params);
  }
  const rows = db
    .prepare(
      `SELECT hour, SUM(is_new) AS nuevas, SUM(1 - is_new) AS antiguas, SUM(is_answered) AS contestadas
       FROM calls WHERE ${where.join(" AND ")} GROUP BY hour`,
    )
    .all(...params) as unknown as HourPoint[];
  const byHour = new Map(rows.map((r) => [Number(r.hour), r]));
  return Array.from({ length: 24 }, (_, h) => {
    const r = byHour.get(h);
    return {
      hour: h,
      nuevas: Number(r?.nuevas ?? 0),
      antiguas: Number(r?.antiguas ?? 0),
      contestadas: Number(r?.contestadas ?? 0),
    };
  });
}

function durations(db: DB, startMs: number, endMs: number, who?: Who): DurationBucket[] {
  const where = ["internal = 0", "is_answered = 1", "start_ms >= ?", "start_ms < ?"];
  const params: number[] = [startMs, endMs];
  const u = userWhere(who);
  if (u) {
    where.push(u.sql);
    params.push(...u.params);
  }
  const rows = db
    .prepare(
      `SELECT MIN(incall_s / 60, 30) AS minute, COUNT(*) AS count FROM calls WHERE ${where.join(" AND ")} GROUP BY 1`,
    )
    .all(...params) as unknown as { minute: number; count: number }[];
  const byMin = new Map(rows.map((r) => [Number(r.minute), Number(r.count)]));
  return Array.from({ length: 31 }, (_, minute) => ({
    minute,
    count: byMin.get(minute) ?? 0,
    zone: minute * 60 < CORTA_S ? "corta" : minute * 60 < LARGA_S ? "media" : "larga",
  }));
}

export interface StatusExtra {
  backfillRunning?: boolean;
  lastError?: string | null;
}

/**
 * Resumen de un periodo. Con `who` (ids de comerciales) todo se limita a esa selección:
 * totales, comparación, serie, horas, duraciones y la tabla. "Nueva" sigue siendo
 * respecto a todo el equipo: una llamada no pasa a ser nueva por filtrar.
 */
export function overview(
  db: DB,
  from: string,
  to: string,
  extra: StatusExtra = {},
  now = Date.now(),
  who?: readonly number[],
): Overview {
  const p = resolvePeriod(from, to, now);
  const c = comparePeriod(p, now);
  const refs = agentRefs(db);
  const live = liveStates(db, now);
  const selected = who?.length ? who : undefined;

  const cur = new Map(
    aggregate(db, p.startMs, p.endMs, { who: selected, groupBy: "user" }).map((r) => [Number(r.k), r]),
  );
  const prev = new Map(
    aggregate(db, c.startMs, c.endMs, { who: selected, groupBy: "user" }).map((r) => [Number(r.k), r]),
  );
  const since = presenceSince(db);
  const curPres =
    since !== null && p.endMs > since ? connectedSeconds(db, p.startMs, p.endMs, selected) : null;
  const prevPres =
    since !== null && c.endMs > since ? connectedSeconds(db, c.startMs, c.endMs, selected) : null;

  // Con selección salen todos los elegidos, aunque no hayan llamado (así se ve que no lo hicieron).
  const ids = new Set<number>([
    ...(selected ?? []),
    ...cur.keys(),
    ...prev.keys(),
    ...(curPres?.keys() ?? []),
  ]);
  const agents: AgentRow[] = [...ids].map((id) => ({
    agent: refFor(refs, id),
    current: toMetrics(
      cur.get(id),
      id !== UNASSIGNED && curPres ? (curPres.get(id) ?? { connected: 0, available: 0 }) : null,
    ),
    previous: toMetrics(
      prev.get(id),
      id !== UNASSIGNED && prevPres ? (prevPres.get(id) ?? { connected: 0, available: 0 }) : null,
    ),
    live: live.get(id) ?? null,
  }));
  agents.sort((a, b) => b.current.llamadas - a.current.llamadas || a.agent.name.localeCompare(b.agent.name));

  const [totRow] = aggregate(db, p.startMs, p.endMs, { who: selected });
  const [prevRow] = aggregate(db, c.startMs, c.endMs, { who: selected });
  return {
    period: info(p),
    compare: { ...info(c), label: c.label },
    totals: toMetrics(totRow, presenceTotal(db, p.startMs, p.endMs, selected)),
    previous: toMetrics(prevRow, presenceTotal(db, c.startMs, c.endMs, selected)),
    series: series(db, p, selected, now),
    agents,
    hours: hours(db, p.startMs, p.endMs, selected),
    durations: durations(db, p.startMs, p.endMs, selected),
    status: dataStatus(db, extra),
  };
}

const info = (p: Period | ComparePeriod) => ({
  from: p.from,
  to: p.to,
  days: p.days,
  partial: p.partial,
  startMs: p.startMs,
  endMs: p.endMs,
});

export function agentDetail(
  db: DB,
  userId: number,
  from: string,
  to: string,
  extra: StatusExtra = {},
  now = Date.now(),
): AgentDetail | null {
  const refs = agentRefs(db);
  if (!refs.has(userId)) return null;
  const p = resolvePeriod(from, to, now);
  const c = comparePeriod(p, now);
  const [cur] = aggregate(db, p.startMs, p.endMs, { who: userId });
  const [prev] = aggregate(db, c.startMs, c.endMs, { who: userId });
  return {
    agent: refFor(refs, userId),
    live: liveStates(db, now).get(userId) ?? null,
    period: info(p),
    compare: { ...info(c), label: c.label },
    totals: toMetrics(cur, presenceTotal(db, p.startMs, p.endMs, userId)),
    previous: toMetrics(prev, presenceTotal(db, c.startMs, c.endMs, userId)),
    series: series(db, p, userId, now),
    hours: hours(db, p.startMs, p.endMs, userId),
    durations: durations(db, p.startMs, p.endMs, userId),
    timeline: p.days === 1 ? timeline(db, userId, p.from, now) : null,
    status: dataStatus(db, extra),
  };
}

/** Jornada de un comercial en un día: tramos conectado y llamadas en el tiempo. */
export function timeline(db: DB, userId: number, day: string, now = Date.now()): Timeline {
  const startMs = localToUtc(day);
  const endMs = Math.min(localToUtc(addDays(day, 1)), now);
  const segs = db
    .prepare(
      "SELECT start_ms, end_ms, snoozed FROM presence_segments WHERE user_id = ? AND end_ms + 60000 > ? AND start_ms < ? ORDER BY start_ms",
    )
    .all(userId, startMs, endMs) as unknown as { start_ms: number; end_ms: number; snoozed: number }[];
  const calls = db
    .prepare(
      `SELECT cdr_id, start_ms, end_ms, total_s, is_answered, is_new, incall_s, direction, contact_number, contact_name
       FROM calls WHERE internal = 0 AND ${userId === UNASSIGNED ? "user_id IS NULL" : "user_id = ?"}
         AND start_ms >= ? AND start_ms < ? ORDER BY start_ms`,
    )
    .all(...(userId === UNASSIGNED ? [startMs, endMs] : [userId, startMs, endMs])) as unknown as {
    cdr_id: number;
    start_ms: number;
    end_ms: number | null;
    total_s: number;
    is_answered: number;
    is_new: number;
    incall_s: number;
    direction: "in" | "out";
    contact_number: string | null;
    contact_name: string | null;
  }[];
  return {
    day,
    startMs,
    endMs,
    segments: segs.map((s) => ({
      startMs: Math.max(s.start_ms, startMs),
      endMs: Math.min(s.end_ms + 60_000, endMs),
      snoozed: !!s.snoozed,
    })),
    calls: calls.map((c) => ({
      id: c.cdr_id,
      startMs: c.start_ms,
      endMs: c.end_ms ?? c.start_ms + c.total_s * 1000,
      answered: !!c.is_answered,
      isNew: !!c.is_new,
      talk: c.incall_s,
      direction: c.direction,
      number: c.contact_number,
      contactName: c.contact_name,
    })),
  };
}

export interface CallFilters {
  from: string;
  to: string;
  agent?: number;
  /** Selección de varios comerciales (se suma a `agent` si vienen los dos). */
  agents?: readonly number[];
  tipo?: "nuevas" | "antiguas";
  resultado?: "contestadas" | "no_contestadas";
  duracion?: "mas15" | "menos5" | "entre5y15";
  numero?: string;
  limit?: number;
  cursor?: string | null;
}

type CallDbRow = {
  cdr_id: number;
  start_ms: number;
  user_id: number | null;
  direction: "in" | "out";
  is_answered: number;
  last_state: string | null;
  incall_s: number;
  total_s: number;
  ringing_s: number;
  contact_number: string | null;
  contact_name: string | null;
  is_new: number;
  record_url: string | null;
  tags: string | null;
};

const toItem = (r: CallDbRow, refs: Map<number, AgentRef>): CallItem => ({
  id: r.cdr_id,
  startMs: r.start_ms,
  agent: r.user_id === null ? refFor(refs, UNASSIGNED) : refFor(refs, r.user_id),
  direction: r.direction,
  answered: !!r.is_answered,
  state: r.last_state,
  talk: r.incall_s,
  total: r.total_s,
  ring: r.ringing_s,
  number: r.contact_number,
  contactName: r.contact_name,
  isNew: !!r.is_new,
  record: r.record_url,
  tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
});

const CALL_COLS =
  "cdr_id, start_ms, user_id, direction, is_answered, last_state, incall_s, total_s, ringing_s, contact_number, contact_name, is_new, record_url, tags";

export function listCalls(db: DB, f: CallFilters, now = Date.now()): CallsPage {
  const p = resolvePeriod(f.from, f.to, now);
  const where = ["internal = 0", "start_ms >= ?", "start_ms < ?"];
  const params: (number | string)[] = [p.startMs, p.endMs];
  const sel = [...(f.agent !== undefined ? [f.agent] : []), ...(f.agents ?? [])];
  const u = userWhere(sel.length ? sel : undefined);
  if (u) {
    where.push(u.sql);
    params.push(...u.params);
  }
  if (f.tipo === "nuevas") where.push("is_new = 1");
  if (f.tipo === "antiguas") where.push("is_new = 0");
  if (f.resultado === "contestadas") where.push("is_answered = 1");
  if (f.resultado === "no_contestadas") where.push("is_answered = 0");
  if (f.duracion === "mas15") where.push(`is_answered = 1 AND incall_s >= ${LARGA_S}`);
  if (f.duracion === "menos5") where.push(`is_answered = 1 AND incall_s < ${CORTA_S}`);
  if (f.duracion === "entre5y15")
    where.push(`is_answered = 1 AND incall_s >= ${CORTA_S} AND incall_s < ${LARGA_S}`);
  if (f.numero) {
    const key = contactKey(f.numero);
    const digits = f.numero.replace(/\D/g, "");
    if (key && digits.length >= 6) {
      where.push("contact_key = ?");
      params.push(key);
    } else if (digits) {
      where.push("contact_number LIKE ?");
      params.push(`%${digits}%`);
    }
  }
  const total = Number(
    (
      db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE ${where.join(" AND ")}`).get(...params) as {
        n: number;
      }
    ).n,
  );
  if (f.cursor) {
    const [ms, id] = f.cursor.split(":").map(Number);
    if (Number.isFinite(ms) && Number.isFinite(id)) {
      where.push("(start_ms < ? OR (start_ms = ? AND cdr_id < ?))");
      params.push(ms as number, ms as number, id as number);
    }
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT ${CALL_COLS} FROM calls WHERE ${where.join(" AND ")} ORDER BY start_ms DESC, cdr_id DESC LIMIT ?`,
    )
    .all(...params, limit + 1) as unknown as CallDbRow[];
  const refs = agentRefs(db);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toItem(r, refs)),
    next: rows.length > limit && last ? `${last.start_ms}:${last.cdr_id}` : null,
    total,
  };
}

export function numberHistory(db: DB, number: string): NumberHistory | null {
  const key = contactKey(number);
  if (!key) return null;
  const rows = db
    .prepare(
      `SELECT ${CALL_COLS} FROM calls WHERE contact_key = ? AND internal = 0 ORDER BY start_ms DESC LIMIT 500`,
    )
    .all(key) as unknown as CallDbRow[];
  const refs = agentRefs(db);
  const firstTalk = db
    .prepare(
      "SELECT MIN(start_ms) AS m FROM calls WHERE contact_key = ? AND is_answered = 1 AND internal = 0",
    )
    .get(key) as { m: number | null };
  return {
    number: rows[0]?.contact_number ?? number.replace(/\D/g, ""),
    firstTalkMs: firstTalk.m,
    calls: rows.map((r) => toItem(r, refs)),
  };
}

export function liveTeam(db: DB, extra: StatusExtra = {}, now = Date.now()): LiveTeam {
  const refs = agentRefs(db);
  const today = localDay(now);
  const startMs = localToUtc(today);
  const todayAgg = new Map(aggregate(db, startMs, now + 1, { groupBy: "user" }).map((r) => [Number(r.k), r]));
  const live = liveStates(db, now);
  const agents = [...live.entries()]
    .filter(([id, l]) => l.connected || todayAgg.has(id))
    .map(([id, l]) => ({
      agent: refFor(refs, id),
      live: l,
      today: {
        llamadas: Number(todayAgg.get(id)?.llamadas ?? 0),
        tiempo_llamada: Number(todayAgg.get(id)?.tiempo_llamada ?? 0),
      },
    }))
    .sort(
      (a, b) =>
        Number(b.live.inCall) - Number(a.live.inCall) ||
        Number(b.live.connected) - Number(a.live.connected) ||
        a.agent.name.localeCompare(b.agent.name),
    );
  return { agents, status: dataStatus(db, extra) };
}

/** Busca un comercial por id, email o nombre (para el MCP). */
export function findAgent(db: DB, query: string): AgentRef | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const refs = [...agentRefs(db).values()].filter((a) => a.id !== UNASSIGNED);
  if (/^\d+$/.test(q)) return refs.find((a) => a.id === Number(q)) ?? null;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
  const nq = norm(q);
  return (
    refs.find((a) => a.email?.toLowerCase() === q) ??
    refs.find((a) => a.email?.toLowerCase().split("@")[0] === q) ??
    refs.find((a) => norm(a.name) === nq) ??
    refs.find((a) => norm(a.name).includes(nq) || (a.email ?? "").toLowerCase().includes(q)) ??
    null
  );
}

/** Métricas simples de un rango (para el MCP). */
export function metricsFor(
  db: DB,
  from: string,
  to: string,
  who?: Who,
  now = Date.now(),
): { period: Period; metrics: Metrics } {
  const p = resolvePeriod(from, to, now);
  const [row] = aggregate(db, p.startMs, p.endMs, { who });
  return { period: p, metrics: toMetrics(row, presenceTotal(db, p.startMs, p.endMs, who)) };
}

/** Métricas entre dos instantes (para comparar "hoy hasta ahora" con el mismo tramo de otro día). */
export function metricsBetween(db: DB, startMs: number, endMs: number, who?: Who): Metrics {
  const [row] = aggregate(db, startMs, endMs, { who });
  return toMetrics(row, presenceTotal(db, startMs, endMs, who));
}

/** Días sin llamar a partir de los cuales un comercial se considera inactivo en el selector. */
export const ACTIVE_DAYS = 60;

/**
 * Todos los comerciales para el selector del panel, con su última llamada. Los activos
 * (llamaron en los últimos ACTIVE_DAYS días o están conectados) van primero, por nombre.
 */
export function agentOptions(db: DB, now = Date.now()): AgentOption[] {
  const refs = agentRefs(db);
  const live = liveStates(db, now);
  const rows = db
    .prepare(
      `SELECT COALESCE(user_id, ${UNASSIGNED}) AS id, MAX(start_ms) AS last_ms
       FROM calls WHERE internal = 0 GROUP BY 1`,
    )
    .all() as unknown as { id: number; last_ms: number }[];
  const last = new Map(rows.map((r) => [Number(r.id), Number(r.last_ms)]));
  const ids = new Set([...refs.keys(), ...last.keys()]);
  const since = now - ACTIVE_DAYS * 86400_000;
  const out: AgentOption[] = [...ids]
    .filter((id) => id !== UNASSIGNED || last.has(UNASSIGNED))
    .map((id) => {
      const lastCallMs = last.get(id) ?? null;
      return {
        ...refFor(refs, id),
        lastCallMs,
        active: (lastCallMs !== null && lastCallMs >= since) || !!live.get(id)?.connected,
      };
    });
  return out.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(a.id === UNASSIGNED) - Number(b.id === UNASSIGNED) ||
      a.name.localeCompare(b.name, "es"),
  );
}

export { comparePeriod, resolvePeriod };
