import { fmtDuration, fmtPct, fmtPhone } from "../../shared/format";
import { CORTA_S, type Metrics } from "../../shared/metrics";
import {
  addDays,
  DAY_MS,
  localDay,
  localHour,
  localSecondOfDay,
  localToUtc,
  TZ,
  weekday,
} from "../../shared/time";
import type { DB } from "../db";
import { agentRefs, liveStates, metricsFor, UNASSIGNED, userWhere, type Who } from "./metrics";

// Análisis que van más allá de las métricas: lo que un jefe de equipo miraría cada día.

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export type AlertLevel = "alta" | "media" | "positiva";

export interface Alert {
  comercial: string;
  nivel: AlertLevel;
  señal: string;
  detalle: string;
}

/** Métricas de un comercial en un día, cortadas a la misma hora si hace falta. */
function dayMetrics(db: DB, userId: number, day: string, untilSecond: number | null): Metrics {
  const start = localToUtc(day);
  const end = untilSecond === null ? localToUtc(addDays(day, 1)) : localToUtc(day, untilSecond);
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS llamadas, COALESCE(SUM(is_answered),0) AS contestadas, COALESCE(SUM(is_new),0) AS nuevas,
              COALESCE(SUM(incall_s),0) AS tiempo_llamada, COALESCE(SUM(is_answered AND incall_s < ${CORTA_S}),0) AS menos5,
              COALESCE(SUM(is_new AND is_answered AND incall_s >= 900),0) AS nuevas_mas15, COALESCE(SUM(is_answered AND incall_s >= 900),0) AS mas15
       FROM calls WHERE internal = 0 AND user_id = ? AND start_ms >= ? AND start_ms < ?`,
    )
    .get(userId, start, end) as Record<string, number>;
  return {
    llamadas: Number(rows.llamadas),
    contestadas: Number(rows.contestadas),
    nuevas: Number(rows.nuevas),
    antiguas: Number(rows.llamadas) - Number(rows.nuevas),
    tiempo_llamada: Number(rows.tiempo_llamada),
    tiempo_telefono: 0,
    tiempo_conectado: null,
    tiempo_disponible: null,
    mas15: Number(rows.mas15),
    menos5: Number(rows.menos5),
    nuevas_mas15: Number(rows.nuevas_mas15),
    salientes: 0,
    entrantes: 0,
    perdidas: 0,
  };
}

/**
 * Señales del día por comercial frente a SU PROPIA media de los 4 mismos días de la
 * semana anteriores (cortada a la misma hora si el día está en curso).
 */
export function alerts(
  db: DB,
  day: string,
  now = Date.now(),
  /** Solo estos comerciales (selección); sin valor, todo el equipo. */
  only?: readonly number[],
): { referencia: string; alertas: Alert[] } {
  const today = localDay(now);
  const partial = day === today;
  const cut = partial ? localSecondOfDay(now) : null;
  const refs = agentRefs(db);
  const live = liveStates(db, now);
  const since = localToUtc(addDays(day, -35));
  const active = db
    .prepare(
      "SELECT DISTINCT user_id FROM calls WHERE user_id IS NOT NULL AND start_ms >= ? AND start_ms < ?",
    )
    .all(since, localToUtc(addDays(day, 1))) as { user_id: number }[];
  const keep = only?.length ? new Set(only) : null;
  const out: Alert[] = [];

  for (const { user_id } of active) {
    if (keep && !keep.has(user_id)) continue;
    const name = refs.get(user_id)?.name ?? `Usuario ${user_id}`;
    const cur = dayMetrics(db, user_id, day, cut);
    const past = [7, 14, 21, 28].map((k) => dayMetrics(db, user_id, addDays(day, -k), cut));
    const worked = past.filter((m) => m.llamadas > 0);
    if (worked.length < 2) continue; // sin histórico suficiente para comparar
    const avg = (k: keyof Metrics) => worked.reduce((a, m) => a + Number(m[k] ?? 0), 0) / worked.length;
    const habitualCalls = avg("llamadas");
    const habitualTalk = avg("tiempo_llamada");

    if (cur.llamadas === 0 && habitualCalls >= 10 && (!partial || localHour(now) >= 11)) {
      out.push({
        comercial: name,
        nivel: "alta",
        señal: "Sin llamadas",
        detalle: `Ninguna llamada ${partial ? "todavía" : "en todo el día"}; lo habitual a esta hora son ${Math.round(habitualCalls)}.`,
      });
      continue;
    }
    if (habitualCalls >= 10 && cur.llamadas < habitualCalls * 0.6) {
      out.push({
        comercial: name,
        nivel: cur.llamadas < habitualCalls * 0.4 ? "alta" : "media",
        señal: "Menos llamadas de lo habitual",
        detalle: `${cur.llamadas} llamadas frente a ${Math.round(habitualCalls)} de media (${fmtPct(cur.llamadas / habitualCalls - 1)}).`,
      });
    }
    if (habitualTalk >= 1200 && cur.tiempo_llamada < habitualTalk * 0.6) {
      out.push({
        comercial: name,
        nivel: "media",
        señal: "Poco tiempo en conversación",
        detalle: `${fmtDuration(cur.tiempo_llamada)} hablando frente a ${fmtDuration(habitualTalk)} de media.`,
      });
    }
    if (cur.contestadas >= 10 && cur.menos5 / cur.contestadas > 0.85) {
      out.push({
        comercial: name,
        nivel: "media",
        señal: "Casi todo son conversaciones cortas",
        detalle: `${fmtPct(cur.menos5 / cur.contestadas)} de sus conversaciones duran menos de 5 minutos.`,
      });
    }
    // En directo: conectado a Ringover pero sin llamar desde hace rato (solo en horario de oficina).
    const l = live.get(user_id);
    if (
      partial &&
      l?.fresh &&
      l.connected &&
      !l.inCall &&
      !l.snoozed &&
      localHour(now) >= 9 &&
      localHour(now) < 20
    ) {
      const last = db.prepare("SELECT MAX(start_ms) AS m FROM calls WHERE user_id = ?").get(user_id) as {
        m: number | null;
      };
      if (last.m && now - last.m > 45 * 60_000 && localDay(last.m) === today) {
        out.push({
          comercial: name,
          nivel: "media",
          señal: "Conectado sin llamar",
          detalle: `Su última llamada fue a las ${hhmm(last.m)} (hace ${Math.round((now - last.m) / 60_000)} min) y sigue conectado.`,
        });
      }
    }
    if (habitualCalls >= 10 && cur.llamadas > habitualCalls * 1.4) {
      out.push({
        comercial: name,
        nivel: "positiva",
        señal: "Por encima de su media",
        detalle: `${cur.llamadas} llamadas frente a ${Math.round(habitualCalls)} habituales.`,
      });
    }
    if (cur.nuevas_mas15 >= 2) {
      out.push({
        comercial: name,
        nivel: "positiva",
        señal: "Buenas primeras conversaciones",
        detalle: `${cur.nuevas_mas15} primeras conversaciones de más de 15 minutos.`,
      });
    }
  }
  const order: Record<AlertLevel, number> = { alta: 0, media: 1, positiva: 2 };
  out.sort((a, b) => order[a.nivel] - order[b.nivel]);
  return {
    referencia: `media de los 4 ${WEEKDAYS[weekday(day)]} anteriores${partial ? ` hasta las ${hhmm(now)}` : ""}`,
    alertas: out,
  };
}

export interface PendingFollowUp {
  numero: string;
  contacto: string | null;
  comercial: string;
  primera_conversacion: string;
  duracion: string;
  duracion_s: number;
  dias_sin_llamar: number;
}

/**
 * Leads con una primera conversación buena y a los que nadie ha vuelto a llamar.
 * Ordenados por duración de esa conversación (los más calientes primero).
 */
export function pendingFollowUps(
  db: DB,
  opts: { minSeconds?: number; daysWithout?: number; lookbackDays?: number; who?: Who; limit?: number },
  now = Date.now(),
): { total: number; seguimientos: PendingFollowUp[] } {
  const minS = opts.minSeconds ?? 300;
  const without = opts.daysWithout ?? 3;
  const from = now - (opts.lookbackDays ?? 30) * DAY_MS;
  const to = now - without * DAY_MS;
  const params: (number | string)[] = [minS, from, to];
  let who = "";
  const u = userWhere(opts.who, "c.user_id");
  if (u) {
    who = `AND ${u.sql}`;
    params.push(...u.params);
  }
  const sql = `FROM calls c
     WHERE c.is_new = 1 AND c.is_answered = 1 AND c.internal = 0 AND c.incall_s >= ?
       AND c.start_ms >= ? AND c.start_ms < ? ${who}
       AND NOT EXISTS (SELECT 1 FROM calls n WHERE n.contact_key = c.contact_key AND n.start_ms > c.start_ms)`;
  const total = Number((db.prepare(`SELECT COUNT(*) AS n ${sql}`).get(...params) as { n: number }).n);
  const rows = db
    .prepare(
      `SELECT c.start_ms, c.user_id, c.incall_s, c.contact_number, c.contact_name ${sql} ORDER BY c.incall_s DESC LIMIT ?`,
    )
    .all(...params, Math.min(opts.limit ?? 25, 100)) as {
    start_ms: number;
    user_id: number | null;
    incall_s: number;
    contact_number: string | null;
    contact_name: string | null;
  }[];
  const refs = agentRefs(db);
  return {
    total,
    seguimientos: rows.map((r) => ({
      numero: fmtPhone(r.contact_number).pretty,
      contacto: r.contact_name,
      comercial: refs.get(r.user_id ?? UNASSIGNED)?.name ?? "—",
      primera_conversacion: new Date(r.start_ms).toLocaleString("es-ES", {
        timeZone: TZ,
        dateStyle: "medium",
        timeStyle: "short",
      }),
      duracion: fmtDuration(r.incall_s),
      duracion_s: r.incall_s,
      dias_sin_llamar: Math.floor((now - r.start_ms) / DAY_MS),
    })),
  };
}

/** A qué horas y días contesta más la gente (tasa de contacto), para planificar las llamadas. */
export function bestHours(db: DB, from: string, to: string, sel?: Who, now = Date.now()) {
  const start = localToUtc(from);
  const end = Math.min(localToUtc(addDays(to, 1)), now);
  const params: (number | string)[] = [start, end];
  let who = "";
  const u = userWhere(sel);
  if (u) {
    who = `AND ${u.sql}`;
    params.push(...u.params);
  }
  const rows = db
    .prepare(
      `SELECT CAST(strftime('%w', day) AS INTEGER) AS dow, hour, COUNT(*) AS llamadas, SUM(is_answered) AS contestadas,
              SUM(is_answered AND incall_s >= 300) AS buenas
       FROM calls WHERE internal = 0 AND direction = 'out' AND start_ms >= ? AND start_ms < ? ${who}
       GROUP BY dow, hour`,
    )
    .all(...params) as { dow: number; hour: number; llamadas: number; contestadas: number; buenas: number }[];
  const cells = rows.map((r) => ({
    dia: WEEKDAYS[(r.dow + 6) % 7] as string,
    hora: `${String(r.hour).padStart(2, "0")}:00`,
    llamadas: Number(r.llamadas),
    tasa_contacto: Number(r.llamadas) ? Number(r.contestadas) / Number(r.llamadas) : 0,
    conversaciones_5min: Number(r.buenas),
  }));
  const minVolume = Math.max(
    10,
    Math.round(cells.reduce((a, c) => a + c.llamadas, 0) / Math.max(1, cells.length) / 2),
  );
  const ranked = cells
    .filter((c) => c.llamadas >= minVolume)
    .sort((a, b) => b.tasa_contacto - a.tasa_contacto);
  const byHour = new Map<string, { llamadas: number; contestadas: number }>();
  for (const r of rows) {
    const h = `${String(r.hour).padStart(2, "0")}:00`;
    const v = byHour.get(h) ?? { llamadas: 0, contestadas: 0 };
    v.llamadas += Number(r.llamadas);
    v.contestadas += Number(r.contestadas);
    byHour.set(h, v);
  }
  const fmt = (c: (typeof cells)[number]) => ({ ...c, tasa_contacto: fmtPct(c.tasa_contacto) });
  return {
    nota: `Solo llamadas salientes. Franjas con al menos ${minVolume} llamadas.`,
    mejores_franjas: ranked.slice(0, 5).map(fmt),
    peores_franjas: ranked.slice(-3).reverse().map(fmt),
    por_hora: [...byHour.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hora, v]) => ({
        hora,
        llamadas: v.llamadas,
        tasa_contacto: fmtPct(v.llamadas ? v.contestadas / v.llamadas : 0),
      })),
  };
}

/** Comparativa lado a lado con ratios que permiten comparar a gente con distinto volumen. */
export function compareAgents(db: DB, userIds: number[], from: string, to: string, now = Date.now()) {
  const refs = agentRefs(db);
  const rows = userIds.map((id) => {
    const m = metricsFor(db, from, to, id, now).metrics;
    return {
      comercial: refs.get(id)?.name ?? `Usuario ${id}`,
      llamadas: m.llamadas,
      nuevas: m.nuevas,
      tasa_contacto: m.llamadas ? fmtPct(m.contestadas / m.llamadas) : "—",
      tiempo_en_llamada: fmtDuration(m.tiempo_llamada),
      media_por_conversacion: m.contestadas ? fmtDuration(m.tiempo_llamada / m.contestadas) : "—",
      pct_mas_15_min: m.contestadas ? fmtPct(m.mas15 / m.contestadas) : "—",
      pct_menos_5_min: m.contestadas ? fmtPct(m.menos5 / m.contestadas) : "—",
      nuevas_mas_15_min: m.nuevas_mas15,
      tiempo_conectado: m.tiempo_conectado === null ? "sin medición" : fmtDuration(m.tiempo_conectado),
    };
  });
  return { periodo: { desde: from, hasta: to }, comparativa: rows };
}
