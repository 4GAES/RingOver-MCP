// Zona horaria del negocio: los días y las horas se cuentan en hora de Madrid, no en UTC.
export const TZ = "Europe/Madrid";
export const DAY_MS = 86_400_000;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(ms: number): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as unknown as LocalParts;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Día local (YYYY-MM-DD) de un instante. */
export function localDay(ms: number): string {
  const p = localParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hora local (0-23) de un instante. */
export function localHour(ms: number): number {
  return localParts(ms).hour;
}

/** Segundos transcurridos desde la medianoche local. */
export function localSecondOfDay(ms: number): number {
  const p = localParts(ms);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/** Diferencia (ms) entre la hora local y UTC en ese instante. */
function offsetMs(ms: number): number {
  const p = localParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC (ms) que corresponde a un día local y unos segundos desde su medianoche. */
export function localToUtc(day: string, secondOfDay = 0): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + secondOfDay * 1000;
  let guess = naive - offsetMs(naive);
  const corrected = naive - offsetMs(guess);
  if (corrected !== guess) guess = corrected;
  return guess;
}

/** Suma días a un día local (YYYY-MM-DD). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Resta meses manteniendo el día del mes (recortado al último día si no existe). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/** Número de días entre dos días locales, ambos incluidos. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS) + 1;
}

/** Lista de días locales de un rango, ambos incluidos. */
export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Día de la semana (0 = lunes … 6 = domingo) de un día local. */
export function weekday(day: string): number {
  const t = new Date(`${day}T12:00:00Z`).getUTCDay();
  return (t + 6) % 7;
}

/** Lunes de la semana de un día local. */
export function startOfWeek(day: string): string {
  return addDays(day, -weekday(day));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

/** Día válido de verdad (AAAA-MM-DD que existe en el calendario: nada de 2026-02-30). */
export const isDay = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
