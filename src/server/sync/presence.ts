import { type DB, getState, setState, tx } from "../db";
import type { Presence } from "../ringover/schemas";

/** Cada cuánto se pregunta a Ringover quién está conectado. */
export const SAMPLE_MS = 60_000;
/** Si entre dos muestras pasa más de esto, el tramo se corta (la app o la API estuvieron caídas). */
export const MAX_GAP_MS = 150_000;

interface OpenSegment {
  id: number;
  user_id: number;
  end_ms: number;
  snoozed: number;
}

/**
 * Registra una muestra de presencia de todo el equipo. Mantiene tramos continuos de
 * conexión por comercial: se alargan mientras el estado no cambia y se cierran si el
 * comercial se desconecta, cambia a "no molestar" o hay un hueco entre muestras.
 */
export function recordPresence(db: DB, list: Presence[], now = Date.now()) {
  tx(db, () => {
    const open = db
      .prepare("SELECT id, user_id, end_ms, snoozed FROM presence_segments WHERE open = 1")
      .all() as unknown as OpenSegment[];
    const openByUser = new Map(open.map((s) => [s.user_id, s]));
    const close = db.prepare("UPDATE presence_segments SET open = 0 WHERE id = ?");
    const extend = db.prepare("UPDATE presence_segments SET end_ms = ? WHERE id = ?");
    const insert = db.prepare(
      "INSERT INTO presence_segments (user_id, start_ms, end_ms, snoozed, open) VALUES (?, ?, ?, ?, 1)",
    );
    const prevNow = db.prepare(
      "SELECT connected, in_call, snoozed, state_since_ms FROM presence_now WHERE user_id = ?",
    );
    const upsertNow = db.prepare(
      `INSERT INTO presence_now (user_id, connected, in_call, snoozed, devices, seen_ms, state_since_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET connected = excluded.connected, in_call = excluded.in_call,
         snoozed = excluded.snoozed, devices = excluded.devices, seen_ms = excluded.seen_ms,
         state_since_ms = excluded.state_since_ms`,
    );

    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.user_id);
      const devices = p.connected_devices ?? 0;
      const connected = devices > 0 ? 1 : 0;
      const snoozed = p.is_snoozed ? 1 : 0;
      const inCall = p.in_call ? 1 : 0;

      const prev = prevNow.get(p.user_id) as
        | { connected: number; in_call: number; snoozed: number; state_since_ms: number }
        | undefined;
      const sameState =
        prev && prev.connected === connected && prev.in_call === inCall && prev.snoozed === snoozed;
      upsertNow.run(
        p.user_id,
        connected,
        inCall,
        snoozed,
        devices,
        now,
        sameState ? prev.state_since_ms : now,
      );

      const seg = openByUser.get(p.user_id);
      if (seg && connected && seg.snoozed === snoozed && now - seg.end_ms <= MAX_GAP_MS) {
        extend.run(now, seg.id);
        continue;
      }
      if (seg) close.run(seg.id);
      if (connected) insert.run(p.user_id, now, now, snoozed);
    }
    // Quien ya no aparece en la lista se da por desconectado.
    for (const seg of open) if (!seen.has(seg.user_id)) close.run(seg.id);
  });
  if (!getState(db, "presence_since_ms")) setState(db, "presence_since_ms", now);
  setState(db, "presence_synced_ms", now);
}

export interface PresenceTotals {
  connected: number;
  available: number;
}

/**
 * Segundos conectados por comercial (y por día si se pide) dentro de [startMs, endMs),
 * recortando cada tramo a la ventana.
 */
export function connectedSeconds(
  db: DB,
  startMs: number,
  endMs: number,
  who?: number | readonly number[],
): Map<number, PresenceTotals> {
  // Uno, varios (selección del panel) o todos los comerciales.
  const ids = who === undefined ? null : typeof who === "number" ? [who] : [...who];
  const rows = db
    .prepare(
      `SELECT user_id, start_ms, end_ms, snoozed FROM presence_segments
       WHERE end_ms + ${SAMPLE_MS} > ? AND start_ms < ? ${
         ids ? `AND user_id IN (${ids.map(() => "?").join(",") || "NULL"})` : ""
       }`,
    )
    .all(startMs, endMs, ...(ids ?? [])) as unknown as {
    user_id: number;
    start_ms: number;
    end_ms: number;
    snoozed: number;
  }[];
  const out = new Map<number, PresenceTotals>();
  for (const r of rows) {
    // Cada muestra representa el minuto que le sigue (el muestreo es cada 60 s).
    const segEnd = r.end_ms + SAMPLE_MS;
    const s = Math.max(r.start_ms, startMs);
    const e = Math.min(segEnd, endMs);
    if (e <= s) continue;
    const secs = (e - s) / 1000;
    const t = out.get(r.user_id) ?? { connected: 0, available: 0 };
    t.connected += secs;
    if (!r.snoozed) t.available += secs;
    out.set(r.user_id, t);
  }
  return out;
}
