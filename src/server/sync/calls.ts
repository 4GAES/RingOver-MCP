import { contactKey } from "../../shared/format";
import { DAY_MS, localDay, localHour } from "../../shared/time";
import { type DB, getState, setState, tx } from "../db";
import { log } from "../log";
import { type RingoverClient, RingoverError } from "../ringover/client";
import type { RingoverCall, RingoverUser } from "../ringover/schemas";

/** La API admite ventanas de hasta 15 días; usamos 14 para ir sobrados. */
export const WINDOW_MS = 14 * DAY_MS;

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};
const secs = (v: number | null | undefined) => Math.max(0, Math.round(v ?? 0));

export interface CallRow {
  cdr_id: number;
  call_id: string | null;
  direction: string;
  type: string | null;
  last_state: string | null;
  is_answered: number;
  start_ms: number;
  answered_ms: number | null;
  end_ms: number | null;
  day: string;
  hour: number;
  incall_s: number;
  total_s: number;
  ringing_s: number;
  hold_s: number;
  queue_s: number;
  user_id: number | null;
  contact_number: string | null;
  contact_key: string | null;
  contact_name: string | null;
  hangup_by: string | null;
  record_url: string | null;
  tags: string | null;
  internal: number;
  raw: string;
  synced_at: number;
}

/** Convierte una llamada de la API en la fila que guardamos. */
export function toRow(c: RingoverCall, now = Date.now()): CallRow | null {
  const start = toMs(c.start_time);
  if (start === null) return null;
  const direction = c.direction === "in" ? "in" : "out";
  const fallback = direction === "out" ? c.to_number : c.from_number;
  const number = String(c.contact_number ?? fallback ?? "").replace(/\D/g, "") || null;
  const key = contactKey(number);
  const incall = secs(c.incall_duration);
  // "Contestada" exige conversación real: el buzón de voz o 0 s no cuentan.
  const answered = c.is_answered && incall > 0 ? 1 : 0;
  const contactName = c.contact
    ? (c.contact.concat_name ?? [c.contact.firstname, c.contact.lastname].filter(Boolean).join(" ")) || null
    : null;
  const tags = c.tags?.map((t) => t.name).filter(Boolean) ?? [];
  return {
    cdr_id: c.cdr_id,
    call_id: c.call_id,
    direction,
    type: c.type,
    last_state: c.last_state,
    is_answered: answered,
    start_ms: start,
    answered_ms: toMs(c.answered_time),
    end_ms: toMs(c.end_time),
    day: localDay(start),
    hour: localHour(start),
    incall_s: answered ? incall : 0,
    total_s: secs(c.total_duration),
    ringing_s: secs(c.ringing_duration),
    hold_s: secs(c.hold_duration),
    queue_s: secs(c.queue_duration),
    user_id: c.user?.user_id ?? null,
    contact_number: number,
    contact_key: key,
    contact_name: contactName,
    hangup_by: c.hangup_by,
    record_url: c.record,
    tags: tags.length ? JSON.stringify(tags) : null,
    // Sin número externo (extensiones, llamadas entre compañeros): fuera de las métricas.
    internal: key === null && number !== null ? 1 : 0,
    raw: JSON.stringify(c),
    synced_at: now,
  };
}

const UPSERT = `
  INSERT INTO calls (cdr_id, call_id, direction, type, last_state, is_answered, start_ms, answered_ms, end_ms,
    day, hour, incall_s, total_s, ringing_s, hold_s, queue_s, user_id, contact_number, contact_key, contact_name,
    hangup_by, record_url, tags, internal, raw, synced_at)
  VALUES ($cdr_id, $call_id, $direction, $type, $last_state, $is_answered, $start_ms, $answered_ms, $end_ms,
    $day, $hour, $incall_s, $total_s, $ringing_s, $hold_s, $queue_s, $user_id, $contact_number, $contact_key,
    $contact_name, $hangup_by, $record_url, $tags, $internal, $raw, $synced_at)
  ON CONFLICT(cdr_id) DO UPDATE SET
    call_id = excluded.call_id, direction = excluded.direction, type = excluded.type,
    last_state = excluded.last_state, is_answered = excluded.is_answered, start_ms = excluded.start_ms,
    answered_ms = excluded.answered_ms, end_ms = excluded.end_ms, day = excluded.day, hour = excluded.hour,
    incall_s = excluded.incall_s, total_s = excluded.total_s, ringing_s = excluded.ringing_s,
    hold_s = excluded.hold_s, queue_s = excluded.queue_s, user_id = excluded.user_id,
    contact_number = excluded.contact_number, contact_key = excluded.contact_key,
    contact_name = excluded.contact_name, hangup_by = excluded.hangup_by, record_url = excluded.record_url,
    tags = excluded.tags, internal = excluded.internal, raw = excluded.raw, synced_at = excluded.synced_at`;

export function upsertAgent(db: DB, u: RingoverUser, now = Date.now()) {
  const name =
    u.concat_name?.trim() ||
    [u.firstname, u.lastname].filter(Boolean).join(" ").trim() ||
    u.email ||
    `#${u.user_id}`;
  const initials =
    u.initial?.trim() ||
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  db.prepare(
    `INSERT INTO agents (user_id, name, firstname, lastname, email, initials, color, picture, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, firstname = excluded.firstname,
       lastname = excluded.lastname, email = COALESCE(excluded.email, agents.email), initials = excluded.initials,
       color = COALESCE(excluded.color, agents.color), picture = COALESCE(excluded.picture, agents.picture),
       updated_at = excluded.updated_at`,
  ).run(u.user_id, name, u.firstname, u.lastname, u.email, initials, u.color, u.picture, now);
}

/** Guarda llamadas (insertar o actualizar) y los comerciales que aparecen en ellas. */
export function saveCalls(db: DB, calls: RingoverCall[], now = Date.now()): number {
  const stmt = db.prepare(UPSERT);
  let saved = 0;
  tx(db, () => {
    const seen = new Set<number>();
    for (const c of calls) {
      const row = toRow(c, now);
      if (!row) continue;
      stmt.run(row as unknown as Record<string, string | number | null>);
      saved++;
      if (c.user && !seen.has(c.user.user_id)) {
        seen.add(c.user.user_id);
        upsertAgent(db, c.user, now);
      }
    }
  });
  return saved;
}

/**
 * Marca qué llamadas son "nuevas": las que van a un número con el que el equipo todavía
 * no había hablado (sin ninguna llamada contestada anterior).
 * Sin `touchedSince` recalcula todo (histórico, repaso nocturno); con él, solo los
 * números de las llamadas guardadas desde ese instante. Solo escribe las filas que cambian.
 */
export function recomputeNewness(db: DB, touchedSince?: number) {
  const scope =
    touchedSince === undefined
      ? ""
      : "WHERE c.contact_key IN (SELECT DISTINCT contact_key FROM calls WHERE synced_at >= $since AND contact_key IS NOT NULL)";
  const sql = `
    UPDATE calls SET is_new = n.v
    FROM (
      SELECT c.cdr_id, CASE
        WHEN c.contact_key IS NULL THEN 0
        WHEN EXISTS (
          SELECT 1 FROM calls p
          WHERE p.contact_key = c.contact_key AND p.is_answered = 1 AND p.internal = 0
            AND p.start_ms < c.start_ms
        ) THEN 0
        WHEN EXISTS (
          SELECT 1 FROM known_contacts k
          WHERE k.contact_key = c.contact_key AND k.first_answered_ms < c.start_ms
        ) THEN 0
        ELSE 1 END AS v
      FROM calls c ${scope}
    ) AS n
    WHERE calls.cdr_id = n.cdr_id AND calls.is_new != n.v`;
  if (touchedSince === undefined) db.exec(sql);
  else db.prepare(sql).run({ $since: touchedSince });
}

async function syncWindow(db: DB, client: RingoverClient, startMs: number, endMs: number): Promise<number> {
  let total = 0;
  for (let s = startMs; s < endMs; s += WINDOW_MS) {
    const e = Math.min(s + WINDOW_MS, endMs);
    const calls = await client.callsBetween(s, e);
    total += saveCalls(db, calls);
  }
  return total;
}

/** Trae lo nuevo desde la última llamada guardada (con 2 h de solape por llamadas largas). */
export async function syncIncremental(db: DB, client: RingoverClient, now = Date.now()): Promise<number> {
  const row = db.prepare("SELECT MAX(start_ms) AS m FROM calls").get() as { m: number | null };
  const from = row.m ? row.m - 2 * 3600_000 : now - 3 * DAY_MS;
  const t0 = Date.now();
  const n = await syncWindow(db, client, from, now + 60_000);
  if (n > 0) recomputeNewness(db, t0);
  setState(db, "calls_synced_ms", now);
  return n;
}

/** Repasa los últimos días completos: estados, etiquetas y grabaciones cambian después. */
export async function reconcile(db: DB, client: RingoverClient, days = 4, now = Date.now()): Promise<number> {
  const n = await syncWindow(db, client, now - days * DAY_MS, now + 60_000);
  recomputeNewness(db);
  setState(db, "reconciled_ms", now);
  return n;
}

/** Ringover guarda un año de llamadas: pedir más atrás devuelve 400. */
export const RETENTION_MS = 364 * DAY_MS;

/**
 * Carga del histórico hacia atrás, por tramos de 14 días, hasta el límite de lo que
 * guarda Ringover (un año), 4 tramos vacíos seguidos o un 400 de la API (fin del
 * histórico disponible). Se puede interrumpir: retoma donde lo dejó.
 */
export async function backfill(db: DB, client: RingoverClient, now = Date.now()): Promise<number> {
  if (getState(db, "backfill_done") === "1") return 0;
  const limit = now - RETENTION_MS;
  let cursor = Number(getState(db, "backfill_cursor_ms") ?? now);
  let empty = Number(getState(db, "backfill_empty") ?? 0);
  let total = 0;
  while (cursor > limit && empty < 4) {
    const start = Math.max(cursor - WINDOW_MS, limit);
    let calls: RingoverCall[];
    try {
      calls = await client.callsBetween(start, cursor);
    } catch (e) {
      if (e instanceof RingoverError && e.status === 400) {
        log.warn("histórico: Ringover no da más atrás", {
          desde: new Date(start).toISOString().slice(0, 10),
        });
        break;
      }
      throw e;
    }
    const saved = saveCalls(db, calls);
    total += saved;
    empty = saved === 0 ? empty + 1 : 0;
    cursor = start;
    setState(db, "backfill_cursor_ms", cursor);
    setState(db, "backfill_empty", empty);
    log.info("histórico: tramo cargado", {
      hasta: new Date(cursor).toISOString().slice(0, 10),
      llamadas: saved,
    });
  }
  recomputeNewness(db);
  setState(db, "backfill_done", "1");
  const first = db.prepare("SELECT MIN(start_ms) AS m FROM calls").get() as { m: number | null };
  if (first.m) setState(db, "history_from_ms", first.m);
  log.info("histórico completo", { llamadas: total });
  return total;
}
