// Diccionario único de métricas: lo usan el panel, la API y el MCP, así un mismo
// indicador da el mismo número en todas partes.

/** Conversación larga: 15 minutos o más de tiempo hablado. */
export const LARGA_S = 15 * 60;
/** Conversación corta: menos de 5 minutos de tiempo hablado (solo contestadas). */
export const CORTA_S = 5 * 60;

export interface Metrics {
  llamadas: number;
  contestadas: number;
  nuevas: number;
  antiguas: number;
  tiempo_llamada: number; // segundos hablados
  tiempo_telefono: number; // segundos totales (tono + espera + hablado)
  tiempo_conectado: number | null; // segundos conectado a Ringover (null = sin medición)
  tiempo_disponible: number | null; // conectado y sin "no molestar"
  mas15: number;
  menos5: number;
  nuevas_mas15: number;
  salientes: number;
  entrantes: number;
  perdidas: number;
}

export type MetricKey =
  | "llamadas"
  | "nuevas"
  | "antiguas"
  | "tiempo_llamada"
  | "tiempo_telefono"
  | "tiempo_conectado"
  | "mas15"
  | "menos5"
  | "nuevas_mas15";

export type MetricKind = "count" | "duration";
/** Si subir es bueno (true), malo (false) o depende (null → color neutro). */
export type Polarity = boolean | null;

export interface MetricDef {
  key: MetricKey;
  label: string;
  short: string;
  group: "volumen" | "tiempo" | "calidad";
  kind: MetricKind;
  upIsGood: Polarity;
  definition: string;
}

export const METRICS: MetricDef[] = [
  {
    key: "llamadas",
    label: "Llamadas",
    short: "Llamadas",
    group: "volumen",
    kind: "count",
    upIsGood: true,
    definition: "Todas las llamadas del comercial, salientes y entrantes, contestadas o no.",
  },
  {
    key: "nuevas",
    label: "Llamadas nuevas",
    short: "Nuevas",
    group: "volumen",
    kind: "count",
    upIsGood: true,
    definition:
      "Llamadas a números con los que el equipo todavía no había hablado. Incluye los intentos sin respuesta y la primera conversación.",
  },
  {
    key: "antiguas",
    label: "Llamadas antiguas",
    short: "Antiguas",
    group: "volumen",
    kind: "count",
    upIsGood: null,
    definition: "Llamadas a números con los que el equipo ya había hablado antes (seguimientos).",
  },
  {
    key: "tiempo_llamada",
    label: "Tiempo en llamada",
    short: "En llamada",
    group: "tiempo",
    kind: "duration",
    upIsGood: true,
    definition: "Tiempo real de conversación de las llamadas contestadas.",
  },
  {
    key: "tiempo_telefono",
    label: "Tiempo al teléfono",
    short: "Al teléfono",
    group: "tiempo",
    kind: "duration",
    upIsGood: null,
    definition: "Duración total de las llamadas: tono, espera y conversación. Tiene histórico completo.",
  },
  {
    key: "tiempo_conectado",
    label: "Tiempo conectado",
    short: "Conectado",
    group: "tiempo",
    kind: "duration",
    upIsGood: true,
    definition:
      "Tiempo con Ringover abierto (al menos un dispositivo conectado), medido cada minuto. Solo existe desde que la app empezó a medirlo.",
  },
  {
    key: "mas15",
    label: "Llamadas de +15 min",
    short: "+15 min",
    group: "calidad",
    kind: "count",
    upIsGood: true,
    definition: "Llamadas contestadas con 15 minutos o más de conversación.",
  },
  {
    key: "menos5",
    label: "Llamadas de menos de 5 min",
    short: "−5 min",
    group: "calidad",
    kind: "count",
    upIsGood: null,
    definition: "Llamadas contestadas con menos de 5 minutos de conversación. Las no contestadas no cuentan.",
  },
  {
    key: "nuevas_mas15",
    label: "Nuevas de +15 min",
    short: "Nuevas +15",
    group: "calidad",
    kind: "count",
    upIsGood: true,
    definition: "Primeras conversaciones (llamadas nuevas contestadas) de 15 minutos o más.",
  },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<
  MetricKey,
  MetricDef
>;

export const GROUPS = [
  { key: "volumen", label: "Volumen" },
  { key: "tiempo", label: "Tiempo" },
  { key: "calidad", label: "Calidad" },
] as const;

export function emptyMetrics(conectado: number | null = null): Metrics {
  return {
    llamadas: 0,
    contestadas: 0,
    nuevas: 0,
    antiguas: 0,
    tiempo_llamada: 0,
    tiempo_telefono: 0,
    tiempo_conectado: conectado,
    tiempo_disponible: conectado,
    mas15: 0,
    menos5: 0,
    nuevas_mas15: 0,
    salientes: 0,
    entrantes: 0,
    perdidas: 0,
  };
}

/** Variación relativa; null si no hay base con la que comparar. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}
