import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fmtDuration, fmtPhone } from "../../shared/format";
import { CORTA_S, delta, LARGA_S, METRICS, type MetricKey, type Metrics } from "../../shared/metrics";
import {
  addDays,
  addMonths,
  isDay,
  localDay,
  startOfMonth,
  startOfWeek,
  TZ,
  weekday,
} from "../../shared/time";
import type { DB } from "../db";
import { alerts, bestHours, compareAgents, pendingFollowUps } from "../queries/insights";
import {
  agentDetail,
  agentRefs,
  dataStatus,
  findAgent,
  listCalls,
  liveTeam,
  metricsBetween,
  metricsFor,
  numberHistory,
  overview,
  type StatusExtra,
  timeline,
  UNASSIGNED,
} from "../queries/metrics";
import { comparePeriod, PeriodError, resolvePeriod } from "../queries/period";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato AAAA-MM-DD")
  .refine(isDay, "Fecha inexistente (AAAA-MM-DD con un día real)")
  .describe("Fecha en formato AAAA-MM-DD (hora de Madrid)");
const metricKeys = METRICS.map((m) => m.key) as [MetricKey, ...MetricKey[]];
const comercialArg = z.string().optional().describe("Un comercial (nombre, email o id): solo sus datos");
const comercialesArg = z
  .array(z.string().min(1))
  .min(1)
  .max(50)
  .optional()
  .describe("Varios comerciales (nombres, emails o ids): todas las cifras pasan a ser solo de ese grupo");

// Atajos de fechas: la IA no tiene que calcular "esta semana" o "el mes pasado" (y no se equivoca).
const PERIODOS = [
  "hoy",
  "ayer",
  "esta_semana",
  "semana_pasada",
  "este_mes",
  "mes_pasado",
  "ultimos_7_dias",
  "ultimos_30_dias",
] as const;
type Periodo = (typeof PERIODOS)[number];
const periodo = z
  .enum(PERIODOS)
  .optional()
  .describe(`Atajo de fechas, mejor que calcular desde/hasta: ${PERIODOS.join(", ")}`);

export function periodRange(p: Periodo, now = Date.now()): [string, string] {
  const t = localDay(now);
  switch (p) {
    case "hoy":
      return [t, t];
    case "ayer":
      return [addDays(t, -1), addDays(t, -1)];
    case "esta_semana":
      return [startOfWeek(t), t];
    case "semana_pasada":
      return [addDays(startOfWeek(t), -7), addDays(startOfWeek(t), -1)];
    case "este_mes":
      return [startOfMonth(t), t];
    case "mes_pasado":
      return [startOfMonth(addMonths(startOfMonth(t), -1)), addDays(startOfMonth(t), -1)];
    case "ultimos_7_dias":
      return [addDays(t, -6), t];
    case "ultimos_30_dias":
      return [addDays(t, -29), t];
  }
}

/** Rango pedido: atajo de periodo, o desde/hasta, o el valor por defecto de la herramienta. */
function pickRange(
  a: { periodo?: Periodo; desde?: string; hasta?: string },
  def: [string, string],
): [string, string] {
  if (a.periodo) return periodRange(a.periodo);
  if (a.desde || a.hasta) return [(a.desde ?? a.hasta) as string, (a.hasta ?? a.desde) as string];
  return def;
}

const WEEKDAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

/** Métricas con números crudos y su versión legible, para que la IA no tenga que convertir segundos. */
function readable(m: Metrics) {
  return {
    llamadas: m.llamadas,
    contestadas: m.contestadas,
    nuevas: m.nuevas,
    antiguas: m.antiguas,
    tiempo_en_llamada: fmtDuration(m.tiempo_llamada),
    tiempo_en_llamada_s: m.tiempo_llamada,
    tiempo_al_telefono: fmtDuration(m.tiempo_telefono),
    tiempo_al_telefono_s: m.tiempo_telefono,
    tiempo_conectado:
      m.tiempo_conectado === null ? "sin medición en este periodo" : fmtDuration(m.tiempo_conectado),
    tiempo_conectado_s: m.tiempo_conectado,
    tiempo_disponible_s: m.tiempo_disponible,
    llamadas_mas_15_min: m.mas15,
    llamadas_menos_5_min: m.menos5,
    nuevas_mas_15_min: m.nuevas_mas15,
    salientes: m.salientes,
    entrantes: m.entrantes,
    entrantes_perdidas: m.perdidas,
  };
}

function changes(cur: Metrics, prev: Metrics) {
  const out: Record<string, string | null> = {};
  for (const def of METRICS) {
    const d = delta(cur[def.key], prev[def.key]);
    out[def.key] = d === null ? null : `${d >= 0 ? "+" : ""}${Math.round(d * 100)}%`;
  }
  return out;
}

// JSON compacto: los modelos lo leen igual de bien y ocupa ~30 % menos de contexto.
const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
});
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

export interface ToolCallEvent {
  tool: string;
  args: unknown;
  ms: number;
  ok: boolean;
  error?: string;
  bytes: number;
}

export interface McpContext {
  /** Se llama tras cada herramienta (para el registro de actividad y consumo). */
  onToolCall?: (e: ToolCallEvent) => void;
}

export interface CatalogEntry {
  name: string;
  title: string;
  description: string;
  /** Parámetros que acepta (para enseñarlos en el panel). */
  params: string[];
}

const BASE_INSTRUCTIONS = `Datos de llamadas de Ringover del equipo comercial de 4Geeks Academy España (solo lectura).
- Fechas en hora de Madrid (${TZ}); "hoy" es el día en curso y se compara hasta la misma hora.
- Una llamada "nueva" va a un número con el que el equipo aún no había hablado; "antigua" es un seguimiento.
- El tiempo conectado solo existe desde que la app empezó a medirlo.
- Para una visión rápida usa 'resumen'; para "qué está pasando" usa 'alertas'; para accionables usa 'seguimientos_pendientes'; para un informe listo para compartir usa 'informe'.
- Para fechas relativas ("esta semana", "el mes pasado"…) usa el parámetro 'periodo' en vez de calcular fechas.
- Para un grupo de comerciales ("Ana, Luis y Marta", "el equipo de Ana") pasa 'comerciales' con sus nombres: todas las cifras pasan a ser solo de ese grupo. Para uno solo, 'comercial'.
- Si dudas de una definición, usa 'definiciones' o el recurso ringover://definiciones.`;

function instructions(now = Date.now()) {
  const t = localDay(now);
  return `Hoy es ${WEEKDAY_NAMES[weekday(t)]} ${t} (hora de Madrid).\n${BASE_INSTRUCTIONS}`;
}

let catalogCache: {
  tools: CatalogEntry[];
  prompts: CatalogEntry[];
  resources: { uri: string; name: string; description: string }[];
} | null = null;

/** Catálogo de herramientas, prompts y recursos (para la pantalla "Conectar" del panel). */
export function mcpCatalog(db: DB) {
  if (!catalogCache) createMcpServer(db, () => ({}));
  return catalogCache as NonNullable<typeof catalogCache>;
}

export function createMcpServer(db: DB, extra: () => StatusExtra, ctx: McpContext = {}): McpServer {
  const server = new McpServer(
    { name: "ringover-4geeks", title: "Ringover 4Geeks · Llamadas España", version: "2.0.0" },
    { instructions: instructions() },
  );

  // Cada herramienta pasa por aquí: se mide, se registra y se cuenta su tamaño (≈ contexto consumido).
  const tools: CatalogEntry[] = [];
  const prompts: CatalogEntry[] = [];
  const resources: { uri: string; name: string; description: string }[] = [];
  const originalRegister = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title?: string; description?: string; inputSchema?: Record<string, unknown> },
    cb: (args: unknown, extra: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }>,
  ) => unknown;
  (server as unknown as { registerTool: typeof originalRegister }).registerTool = (name, config, cb) => {
    tools.push({
      name,
      title: config.title ?? name,
      description: config.description ?? "",
      params: Object.keys(config.inputSchema ?? {}),
    });
    return originalRegister(name, config, async (args, reqExtra) => {
      const t0 = performance.now();
      try {
        const res = await cb(args, reqExtra);
        const text = res.content.map((p) => p.text ?? "").join("");
        ctx.onToolCall?.({
          tool: name,
          args,
          ms: performance.now() - t0,
          ok: !res.isError,
          error: res.isError ? text.slice(0, 300) : undefined,
          bytes: Buffer.byteLength(text),
        });
        return res;
      } catch (e) {
        ctx.onToolCall?.({
          tool: name,
          args,
          ms: performance.now() - t0,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          bytes: 0,
        });
        throw e;
      }
    });
  };

  const today = () => localDay(Date.now());
  const resolveAgent = (q?: string) => {
    if (!q) return { id: undefined as number | undefined, name: "Todo el equipo" };
    const a = findAgent(db, q);
    if (!a)
      throw new PeriodError(
        `No encuentro al comercial "${q}". Usa la herramienta 'comerciales' para ver la lista.`,
      );
    return { id: a.id, name: a.name };
  };
  /**
   * Uno ('comercial'), varios ('comerciales') o, sin ninguno, todo el equipo (ids undefined).
   * Si falta alguien, dice exactamente quién para que la IA lo corrija de una vez.
   */
  const resolveWho = (comercial?: string, comerciales?: string[]) => {
    const queries = [...(comercial ? [comercial] : []), ...(comerciales ?? [])];
    if (!queries.length) return { ids: undefined as number[] | undefined, name: "Todo el equipo", names: [] };
    const found = new Map<number, string>();
    const missing: string[] = [];
    for (const q of queries) {
      const a = findAgent(db, q);
      if (a) found.set(a.id, a.name);
      else missing.push(`"${q}"`);
    }
    if (missing.length)
      throw new PeriodError(
        `No encuentro ${missing.length === 1 ? "al comercial" : "a los comerciales"} ${missing.join(", ")}. Usa la herramienta 'comerciales' para ver la lista.`,
      );
    const names = [...found.values()];
    return {
      ids: [...found.keys()],
      name: names.length === 1 ? (names[0] as string) : `Grupo: ${names.join(", ")}`,
      names,
    };
  };
  const guard = async <T>(fn: () => T | Promise<T>) => {
    try {
      return json(await fn());
    } catch (e) {
      if (e instanceof PeriodError) return fail(e.message);
      throw e;
    }
  };

  server.registerTool(
    "resumen",
    {
      title: "Resumen de llamadas",
      description:
        "Métricas de llamadas de un día o un rango: totales del equipo (o de un comercial, o de un grupo de comerciales), comparación con el periodo anterior equivalente y desglose por comercial. Sin fechas, devuelve hoy.",
      inputSchema: {
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
        comercial: comercialArg,
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo: per, desde, hasta, comercial, comerciales }) =>
      guard(() => {
        const [from, to] = pickRange({ periodo: per, desde, hasta }, [today(), today()]);
        const who = resolveWho(comercial, comerciales);
        if (who.ids?.length === 1) {
          const d = agentDetail(db, who.ids[0] as number, from, to, extra());
          if (!d) throw new PeriodError("Comercial sin datos");
          return {
            comercial: d.agent.name,
            periodo: d.period,
            comparado_con: { ...d.compare, explicacion: d.compare.label },
            metricas: readable(d.totals),
            periodo_anterior: readable(d.previous),
            variacion: changes(d.totals, d.previous),
          };
        }
        const o = overview(db, from, to, extra(), Date.now(), who.ids);
        return {
          periodo: o.period,
          comparado_con: { ...o.compare, explicacion: o.compare.label },
          ...(who.ids
            ? {
                grupo: who.names,
                grupo_total: readable(o.totals),
                grupo_periodo_anterior: readable(o.previous),
              }
            : { equipo: readable(o.totals), equipo_periodo_anterior: readable(o.previous) }),
          variacion: changes(o.totals, o.previous),
          por_comercial: o.agents.map((a) => ({
            comercial: a.agent.name,
            email: a.agent.email,
            id: a.agent.id,
            metricas: readable(a.current),
            variacion: changes(a.current, a.previous),
          })),
          datos_actualizados: o.status.callsSyncedMs ? new Date(o.status.callsSyncedMs).toISOString() : null,
        };
      }),
  );

  server.registerTool(
    "evolucion",
    {
      title: "Evolución en el tiempo",
      description:
        "Serie de métricas por día, semana o mes en un rango (máximo 400 días), del equipo, de un comercial o de un grupo. Sin fechas, los últimos 30 días.",
      inputSchema: {
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
        agrupar: z.enum(["dia", "semana", "mes"]).default("dia"),
        comercial: comercialArg,
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo: per, desde, hasta, agrupar, comercial, comerciales }) =>
      guard(() => {
        const who = resolveWho(comercial, comerciales);
        const [from0, to0] = pickRange({ periodo: per, desde, hasta }, periodRange("ultimos_30_dias"));
        const p = resolvePeriod(from0, to0);
        const buckets: { desde: string; hasta: string }[] = [];
        let cur = p.from;
        while (cur <= p.to) {
          let end = cur;
          if (agrupar === "semana")
            end = addDays(cur, 6 - ((new Date(`${cur}T12:00:00Z`).getUTCDay() + 6) % 7));
          if (agrupar === "mes") {
            const [y, m] = cur.split("-").map(Number) as [number, number];
            end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
          }
          if (end > p.to) end = p.to;
          buckets.push({ desde: cur, hasta: end });
          cur = addDays(end, 1);
        }
        return {
          comercial: who.name,
          agrupado_por: agrupar,
          serie: buckets.map((b) => ({
            ...b,
            ...readable(metricsFor(db, b.desde, b.hasta, who.ids).metrics),
          })),
        };
      }),
  );

  server.registerTool(
    "comparar",
    {
      title: "Comparar dos periodos",
      description:
        "Compara las métricas de dos periodos cualquiera (por ejemplo, esta semana contra la misma semana del mes pasado), del equipo, de un comercial o de un grupo. Si solo das el periodo A, se compara con el periodo anterior equivalente.",
      inputSchema: {
        periodo_a: periodo,
        a_desde: day.optional(),
        a_hasta: day.optional(),
        periodo_b: periodo,
        b_desde: day.optional(),
        b_hasta: day.optional(),
        comercial: comercialArg,
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ periodo_a, a_desde, a_hasta, periodo_b, b_desde, b_hasta, comercial, comerciales }) =>
      guard(() => {
        const who = resolveWho(comercial, comerciales);
        const [af, at] = pickRange({ periodo: periodo_a, desde: a_desde, hasta: a_hasta }, [
          today(),
          today(),
        ]);
        const a = metricsFor(db, af, at, who.ids);
        let b: { from: string; to: string; metrics: Metrics; label: string };
        if (periodo_b || b_desde || b_hasta) {
          const [bf, bt] = pickRange({ periodo: periodo_b, desde: b_desde, hasta: b_hasta }, [af, at]);
          const r = metricsFor(db, bf, bt, who.ids);
          b = { from: r.period.from, to: r.period.to, metrics: r.metrics, label: "periodo indicado" };
        } else {
          // Mismo criterio que el panel: si A está en curso, B se corta a la misma hora.
          const c = comparePeriod(a.period);
          b = {
            from: c.from,
            to: c.to,
            metrics: metricsBetween(db, c.startMs, c.endMs, who.ids),
            label: c.label,
          };
        }
        return {
          comercial: who.name,
          periodo_a: {
            desde: a.period.from,
            hasta: a.period.to,
            en_curso: a.period.partial,
            ...readable(a.metrics),
          },
          periodo_b: { desde: b.from, hasta: b.to, explicacion: b.label, ...readable(b.metrics) },
          variacion_a_frente_a_b: changes(a.metrics, b.metrics),
        };
      }),
  );

  server.registerTool(
    "ranking",
    {
      title: "Ranking de comerciales",
      description:
        "Ordena a los comerciales por una métrica en un periodo (a todo el equipo o solo a un grupo). Sin fechas, usa hoy.",
      inputSchema: {
        metrica: z.enum(metricKeys).describe(METRICS.map((m) => `${m.key}: ${m.label}`).join(" · ")),
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
        orden: z.enum(["desc", "asc"]).default("desc"),
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true },
    },
    ({ metrica, periodo: per, desde, hasta, orden, comerciales }) =>
      guard(() => {
        const [from, to] = pickRange({ periodo: per, desde, hasta }, [today(), today()]);
        const who = resolveWho(undefined, comerciales);
        const o = overview(db, from, to, extra(), Date.now(), who.ids);
        const rows = o.agents
          .filter((a) => a.agent.id !== UNASSIGNED)
          .map((a) => ({ comercial: a.agent.name, valor: a.current[metrica], anterior: a.previous[metrica] }))
          .sort((x, y) => ((y.valor ?? -1) - (x.valor ?? -1)) * (orden === "desc" ? 1 : -1));
        const def = METRICS.find((m) => m.key === metrica);
        return {
          metrica: def?.label,
          periodo: o.period,
          ranking: rows.map((r, i) => ({
            puesto: i + 1,
            ...r,
            valor_legible: def?.kind === "duration" ? fmtDuration(r.valor) : r.valor,
          })),
        };
      }),
  );

  server.registerTool(
    "llamadas",
    {
      title: "Listado de llamadas",
      description:
        "Lista llamadas individuales con filtros (tipo, resultado, duración, teléfono, un comercial o un grupo). Devuelve como mucho 200 (las más recientes primero).",
      inputSchema: {
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
        comercial: comercialArg,
        comerciales: comercialesArg,
        tipo: z.enum(["nuevas", "antiguas"]).optional(),
        resultado: z.enum(["contestadas", "no_contestadas"]).optional(),
        duracion: z.enum(["mas15", "menos5", "entre5y15"]).optional(),
        numero: z.string().optional().describe("Teléfono del contacto (cualquier formato)"),
        limite: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      guard(() => {
        const who = resolveWho(a.comercial, a.comerciales);
        const [from, to] = pickRange(a, [today(), today()]);
        const page = listCalls(db, {
          from,
          to,
          agents: who.ids,
          tipo: a.tipo,
          resultado: a.resultado,
          duracion: a.duracion,
          numero: a.numero,
          limit: a.limite,
        });
        return {
          total_que_cumplen: page.total,
          mostradas: page.items.length,
          llamadas: page.items.map((c) => ({
            hora: new Date(c.startMs).toLocaleString("es-ES", { timeZone: TZ }),
            comercial: c.agent?.name ?? null,
            sentido: c.direction === "out" ? "saliente" : "entrante",
            contacto: fmtPhone(c.number).pretty,
            nombre_contacto: c.contactName,
            contestada: c.answered,
            estado: c.state,
            conversacion: fmtDuration(c.talk),
            conversacion_s: c.talk,
            nueva: c.isNew,
            grabacion: c.record,
          })),
        };
      }),
  );

  server.registerTool(
    "historial_numero",
    {
      title: "Historial de un número",
      description: "Todas las llamadas con un teléfono concreto y cuándo fue la primera conversación.",
      inputSchema: { numero: z.string().min(6) },
      annotations: { readOnlyHint: true },
    },
    ({ numero }) =>
      guard(() => {
        const h = numberHistory(db, numero);
        if (!h || h.calls.length === 0)
          return { numero, llamadas: 0, mensaje: "No hay llamadas con ese número" };
        return {
          numero: fmtPhone(h.number).pretty,
          primera_conversacion: h.firstTalkMs
            ? new Date(h.firstTalkMs).toLocaleString("es-ES", { timeZone: TZ })
            : null,
          total_llamadas: h.calls.length,
          llamadas: h.calls.map((c) => ({
            hora: new Date(c.startMs).toLocaleString("es-ES", { timeZone: TZ }),
            comercial: c.agent?.name ?? null,
            contestada: c.answered,
            conversacion: fmtDuration(c.talk),
            nueva: c.isNew,
          })),
        };
      }),
  );

  server.registerTool(
    "jornada",
    {
      title: "Jornada de un comercial",
      description:
        "Cómo fue el día de un comercial: primera y última llamada, tramos conectado a Ringover, huecos largos sin llamar y métricas del día.",
      inputSchema: { comercial: z.string(), fecha: day.optional() },
      annotations: { readOnlyHint: true },
    },
    ({ comercial, fecha }) =>
      guard(() => {
        const who = resolveAgent(comercial);
        if (who.id === undefined) throw new PeriodError("Indica un comercial");
        const d = fecha ?? today();
        resolvePeriod(d, d);
        const t = timeline(db, who.id, d);
        const hhmm = (ms: number) =>
          new Date(ms).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
        const gaps: { desde: string; hasta: string; minutos: number }[] = [];
        for (let i = 1; i < t.calls.length; i++) {
          const prev = t.calls[i - 1];
          const cur = t.calls[i];
          if (!prev || !cur) continue;
          const gap = (cur.startMs - prev.endMs) / 60_000;
          if (gap >= 30)
            gaps.push({ desde: hhmm(prev.endMs), hasta: hhmm(cur.startMs), minutos: Math.round(gap) });
        }
        return {
          comercial: who.name,
          fecha: d,
          primera_llamada: t.calls[0] ? hhmm(t.calls[0].startMs) : null,
          ultima_llamada: t.calls.at(-1) ? hhmm((t.calls.at(-1) as { startMs: number }).startMs) : null,
          tramos_conectado: t.segments.map((s) => ({
            desde: hhmm(s.startMs),
            hasta: hhmm(s.endMs),
            no_molestar: s.snoozed,
          })),
          huecos_de_30_min_o_mas_sin_llamar: gaps,
          metricas: readable(metricsFor(db, d, d, who.id).metrics),
        };
      }),
  );

  server.registerTool(
    "estado_ahora",
    {
      title: "Quién está conectado ahora",
      description:
        "Estado en vivo del equipo (o de un grupo de comerciales): conectado, en llamada o en no molestar, y sus llamadas de hoy.",
      inputSchema: { comerciales: comercialesArg },
      annotations: { readOnlyHint: true },
    },
    ({ comerciales }) =>
      guard(() => {
        const live = liveTeam(db, extra());
        const who = resolveWho(undefined, comerciales);
        const keep = who.ids ? new Set(who.ids) : null;
        return {
          estado_presencia: live.status.presenceStatus,
          ...(who.ids ? { grupo: who.names } : {}),
          comerciales: live.agents
            .filter((a) => !keep || keep.has(a.agent.id))
            .map((a) => ({
              comercial: a.agent.name,
              estado: !a.live.connected
                ? "desconectado"
                : a.live.inCall
                  ? "en llamada"
                  : a.live.snoozed
                    ? "no molestar"
                    : "disponible",
              desde: new Date(a.live.sinceMs).toLocaleTimeString("es-ES", {
                timeZone: TZ,
                hour: "2-digit",
                minute: "2-digit",
              }),
              llamadas_hoy: a.today.llamadas,
              tiempo_en_llamada_hoy: fmtDuration(a.today.tiempo_llamada),
            })),
        };
      }),
  );

  server.registerTool(
    "comerciales",
    {
      title: "Lista de comerciales",
      description: "Comerciales con llamadas registradas (id, nombre y email).",
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(() => ({
        comerciales: [...agentRefs(db).values()]
          .filter((a) => a.id !== UNASSIGNED)
          .map((a) => ({ id: a.id, nombre: a.name, email: a.email })),
      })),
  );

  server.registerTool(
    "definiciones",
    {
      title: "Cómo se calcula cada métrica",
      description: "Definición exacta de cada métrica y frescura de los datos.",
      annotations: { readOnlyHint: true },
    },
    () =>
      guard(() => {
        const s = dataStatus(db, extra());
        return {
          zona_horaria: TZ,
          umbrales: { conversacion_larga_s: LARGA_S, conversacion_corta_s: CORTA_S },
          metricas: METRICS.map((m) => ({ clave: m.key, nombre: m.label, definicion: m.definition })),
          notas: [
            "Una llamada contestada exige conversación real (más de 0 s hablados).",
            "Las llamadas sin número externo (internas) no cuentan.",
            "Los números se casan por sus últimos 9 dígitos.",
          ],
          datos: {
            llamadas_actualizadas: s.callsSyncedMs ? new Date(s.callsSyncedMs).toISOString() : null,
            historico_desde: s.historyFromMs ? new Date(s.historyFromMs).toISOString().slice(0, 10) : null,
            conexion_medida_desde: s.presenceSinceMs ? new Date(s.presenceSinceMs).toISOString() : null,
            estado_medicion_conexion: s.presenceStatus,
          },
        };
      }),
  );

  // ── Herramientas de análisis ───────────────────────────────────────────────

  server.registerTool(
    "alertas",
    {
      title: "Señales del día",
      description:
        "Qué está pasando hoy (o un día concreto): comerciales por debajo o por encima de SU PROPIA media, sin llamadas, conectados sin llamar, demasiadas conversaciones cortas o buenas primeras conversaciones. Se puede limitar a un grupo.",
      inputSchema: { fecha: day.optional(), comerciales: comercialesArg },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ fecha, comerciales }) =>
      guard(() => {
        const d = fecha ?? today();
        resolvePeriod(d, d);
        const who = resolveWho(undefined, comerciales);
        const a = alerts(db, d, Date.now(), who.ids);
        return {
          fecha: d,
          ...(who.ids ? { grupo: who.names } : {}),
          comparado_con: a.referencia,
          total: a.alertas.length,
          alertas: a.alertas,
        };
      }),
  );

  server.registerTool(
    "seguimientos_pendientes",
    {
      title: "Seguimientos pendientes",
      description:
        "Leads con una primera conversación buena a los que nadie ha vuelto a llamar desde hace días, del equipo, de un comercial o de un grupo. Ordenados por la duración de esa conversación (los más calientes primero). Muy útil para priorizar el trabajo de hoy.",
      inputSchema: {
        minutos_minimos: z
          .number()
          .min(1)
          .max(60)
          .default(5)
          .describe("Duración mínima de la primera conversación"),
        dias_sin_llamar: z.number().int().min(1).max(30).default(3),
        ultimos_dias: z.number().int().min(3).max(120).default(30).describe("Hasta cuántos días atrás mirar"),
        comercial: comercialArg,
        comerciales: comercialesArg,
        limite: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) =>
      guard(() => {
        const who = resolveWho(a.comercial, a.comerciales);
        const r = pendingFollowUps(db, {
          minSeconds: a.minutos_minimos * 60,
          daysWithout: a.dias_sin_llamar,
          lookbackDays: a.ultimos_dias,
          who: who.ids,
          limit: a.limite,
        });
        return {
          comercial: who.name,
          criterio: `Primera conversación de ${a.minutos_minimos}+ min en los últimos ${a.ultimos_dias} días y sin ninguna llamada después durante ${a.dias_sin_llamar}+ días`,
          total: r.total,
          mostrados: r.seguimientos.length,
          seguimientos: r.seguimientos,
        };
      }),
  );

  server.registerTool(
    "mejores_horas",
    {
      title: "Mejores horas para llamar",
      description:
        "Tasa de contacto (qué porcentaje contesta) por día de la semana y hora, para saber cuándo llamar, del equipo, de un comercial o de un grupo. Por defecto, las últimas 4 semanas.",
      inputSchema: {
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
        comercial: comercialArg,
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) =>
      guard(() => {
        const [from, to] = pickRange(a, [addDays(today(), -27), today()]);
        resolvePeriod(from, to);
        const who = resolveWho(a.comercial, a.comerciales);
        return {
          comercial: who.name,
          periodo: { desde: from, hasta: to },
          ...bestHours(db, from, to, who.ids),
        };
      }),
  );

  server.registerTool(
    "comparar_comerciales",
    {
      title: "Comparar comerciales",
      description:
        "Comparativa lado a lado de varios comerciales en un periodo, con ratios (tasa de contacto, media por conversación, % de +15 min) para comparar a gente con distinto volumen. Sin nombres, compara a todo el equipo.",
      inputSchema: {
        comerciales: z.array(z.string()).max(20).optional(),
        periodo,
        desde: day.optional(),
        hasta: day.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (a) =>
      guard(() => {
        const [from, to] = pickRange(a, [today(), today()]);
        resolvePeriod(from, to);
        let ids: number[];
        if (a.comerciales?.length) ids = resolveWho(undefined, a.comerciales).ids as number[];
        else
          ids = overview(db, from, to, extra())
            .agents.map((r) => r.agent.id)
            .filter((id) => id !== UNASSIGNED);
        return compareAgents(db, ids, from, to);
      }),
  );

  server.registerTool(
    "informe",
    {
      title: "Informe listo para compartir",
      description:
        "Genera un informe en Markdown (diario o semanal) del equipo o de un grupo de comerciales: resumen, métricas con su variación, tabla por comercial, señales del día, seguimientos pendientes y mejores horas. Pensado para pegar en Slack o en un email.",
      inputSchema: {
        tipo: z.enum(["diario", "semanal"]).default("diario"),
        fecha: day.optional(),
        comerciales: comercialesArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ tipo, fecha, comerciales }) => {
      try {
        const who = resolveWho(undefined, comerciales);
        const md = buildReport(db, tipo, fecha ?? today(), extra(), who.ids ? who : undefined);
        return Promise.resolve({ content: [{ type: "text" as const, text: md }] });
      } catch (e) {
        if (e instanceof PeriodError) return Promise.resolve(fail(e.message));
        throw e;
      }
    },
  );

  // ── Recursos ───────────────────────────────────────────────────────────────
  server.registerResource(
    "definiciones",
    "ringover://definiciones",
    {
      title: "Cómo se calcula cada métrica",
      description: "Definiciones exactas y umbrales",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# Métricas de llamadas · Ringover 4Geeks",
            "",
            ...METRICS.map((m) => `- **${m.label}**: ${m.definition}`),
            "",
            `Umbrales: conversación larga ≥ ${LARGA_S / 60} min; corta < ${CORTA_S / 60} min (solo contestadas). Zona horaria: ${TZ}.`,
          ].join("\n"),
        },
      ],
    }),
  );
  resources.push({
    uri: "ringover://definiciones",
    name: "Definiciones",
    description: "Cómo se calcula cada métrica",
  });

  server.registerResource(
    "comerciales",
    "ringover://comerciales",
    {
      title: "Comerciales",
      description: "Lista de comerciales con id y email",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            [...agentRefs(db).values()]
              .filter((a) => a.id !== UNASSIGNED)
              .map((a) => ({ id: a.id, nombre: a.name, email: a.email })),
            null,
            2,
          ),
        },
      ],
    }),
  );
  resources.push({ uri: "ringover://comerciales", name: "Comerciales", description: "Lista de comerciales" });

  // ── Prompts (aparecen como comandos en Claude) ───────────────────────────
  const prompt = (
    name: string,
    title: string,
    description: string,
    argsSchema: Record<string, z.ZodType<string | undefined>>,
    text: (a: Record<string, string | undefined>) => string,
  ) => {
    prompts.push({ name, title, description, params: Object.keys(argsSchema) });
    const cb = (a: Record<string, string | undefined>) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: text(a) } }],
    });
    server.registerPrompt(name, { title, description, argsSchema: argsSchema as never }, cb as never);
  };
  prompt(
    "informe_diario",
    "Informe diario",
    "Resumen del día con conclusiones y acciones",
    { fecha: z.string().optional().describe("AAAA-MM-DD; por defecto hoy") },
    (a) =>
      `Usa la herramienta 'informe' (tipo diario${a.fecha ? `, fecha ${a.fecha}` : ""}) y también 'alertas'. Preséntame el informe y termina con: 3 conclusiones clave y 3 acciones concretas para mañana, nombrando a las personas.`,
  );
  prompt(
    "informe_semanal",
    "Informe semanal",
    "La semana del equipo, tendencias y prioridades",
    { fecha: z.string().optional().describe("Un día de la semana a analizar (AAAA-MM-DD)") },
    (a) =>
      `Usa 'informe' (tipo semanal${a.fecha ? `, fecha ${a.fecha}` : ""}), 'comparar_comerciales' para esa semana y 'mejores_horas'. Resume la semana, quién mejora y quién necesita apoyo (comparando a cada uno con su propia media), y propón prioridades para la semana que viene.`,
  );
  prompt(
    "revisar_comercial",
    "Revisar a un comercial",
    "Cómo le va a una persona, con datos y recomendaciones",
    { comercial: z.string().describe("Nombre o email del comercial") },
    (a) =>
      `Analiza a ${a.comercial}: usa 'resumen' de esta semana y de la anterior, 'jornada' de hoy, 'mejores_horas' y 'seguimientos_pendientes' filtrando por esa persona. Dame fortalezas, puntos de mejora y 3 recomendaciones concretas. Compárale con su propia media, no con los demás.`,
  );
  prompt(
    "revisar_grupo",
    "Revisar a un grupo",
    "Cómo le va a un grupo de comerciales, juntos y por separado",
    { comerciales: z.string().describe("Nombres o emails separados por comas") },
    (a) =>
      `Analiza al grupo formado por ${a.comerciales}: usa 'resumen' con comerciales=[${a.comerciales}] para esta semana, 'comparar' del grupo con la semana pasada, 'comparar_comerciales' entre ellos y 'seguimientos_pendientes' del grupo. Dime cómo va el grupo, quién tira y quién necesita apoyo (comparando a cada uno con su propia media) y 3 acciones concretas.`,
  );
  prompt(
    "seguimientos",
    "Seguimientos de hoy",
    "Leads calientes que nadie ha vuelto a llamar",
    { comercial: z.string().optional().describe("Opcional: solo los de esta persona") },
    (a) =>
      `Usa 'seguimientos_pendientes'${a.comercial ? ` para ${a.comercial}` : ""} y prepara la lista de llamadas prioritarias de hoy, agrupada por comercial, con el número, cuándo fue la primera conversación y cuánto duró.`,
  );

  catalogCache ??= { tools, prompts, resources };
  return server;
}

/** Informe en Markdown (diario o semanal) listo para compartir. */
function buildReport(
  db: DB,
  tipo: "diario" | "semanal",
  fecha: string,
  extra: StatusExtra,
  group?: { ids?: number[]; names: string[] },
): string {
  const from =
    tipo === "diario" ? fecha : addDays(fecha, -((new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7));
  const to = tipo === "diario" ? fecha : addDays(from, 6);
  const ids = group?.ids;
  const o = overview(db, from, to, extra, Date.now(), ids);
  const m = o.totals;
  const p = o.previous;
  const pct = (a: number | null, b: number | null) => {
    const d = delta(a, b);
    return d === null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}%`;
  };
  const when =
    tipo === "diario"
      ? `${o.period.from}${o.period.partial ? " (en curso)" : ""}`
      : `${o.period.from} → ${o.period.to}${o.period.partial ? " (en curso)" : ""}`;
  const lines: string[] = [
    `# Llamadas España · informe ${tipo} · ${when}`,
    ...(group ? ["", `**Grupo:** ${group.names.join(", ")}`] : []),
    "",
    `**${m.llamadas} llamadas** (${m.nuevas} nuevas, ${m.antiguas} antiguas) · **${fmtDuration(m.tiempo_llamada)}** de conversación · **${m.mas15}** de +15 min (${m.nuevas_mas15} primeras conversaciones).`,
    `_Comparado con ${o.compare.from}${o.compare.from !== o.compare.to ? ` → ${o.compare.to}` : ""} (${o.compare.label})._`,
    "",
    "| Métrica | Valor | Variación |",
    "|---|---:|---:|",
    ...METRICS.map((def) => {
      const v = m[def.key];
      const shown = v === null ? "sin medición" : def.kind === "duration" ? fmtDuration(v) : String(v);
      return `| ${def.label} | ${shown} | ${pct(v, p[def.key])} |`;
    }),
    "",
    "## Por comercial",
    "",
    "| Comercial | Llamadas | Nuevas | En llamada | +15 min | −5 min | Nuevas +15 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...o.agents
      .filter((a) => a.current.llamadas > 0)
      .map(
        (a) =>
          `| ${a.agent.name} | ${a.current.llamadas} (${pct(a.current.llamadas, a.previous.llamadas)}) | ${a.current.nuevas} | ${fmtDuration(a.current.tiempo_llamada)} | ${a.current.mas15} | ${a.current.menos5} | ${a.current.nuevas_mas15} |`,
      ),
  ];
  const al = alerts(db, to > localDay(Date.now()) ? localDay(Date.now()) : to, Date.now(), ids);
  if (al.alertas.length) {
    const icon = { alta: "🔴", media: "🟠", positiva: "🟢" } as const;
    lines.push(
      "",
      `## Señales (${al.referencia})`,
      "",
      ...al.alertas.map((a) => `- ${icon[a.nivel]} **${a.comercial}** · ${a.señal}: ${a.detalle}`),
    );
  }
  const f = pendingFollowUps(db, { limit: 5, who: ids });
  if (f.total) {
    lines.push(
      "",
      `## Seguimientos pendientes (${f.total})`,
      "",
      ...f.seguimientos.map(
        (s) =>
          `- ${s.numero}${s.contacto ? ` (${s.contacto})` : ""} · ${s.comercial} · ${s.duracion} el ${s.primera_conversacion} · ${s.dias_sin_llamar} días sin llamar`,
      ),
    );
  }
  const bh = bestHours(db, addDays(to, -27), to, ids);
  if (bh.mejores_franjas.length) {
    lines.push(
      "",
      "## Mejores franjas para llamar (últimas 4 semanas)",
      "",
      ...bh.mejores_franjas
        .slice(0, 3)
        .map((h) => `- ${h.dia} ${h.hora}: ${h.tasa_contacto} contesta (${h.llamadas} llamadas)`),
    );
  }
  return lines.join("\n");
}
