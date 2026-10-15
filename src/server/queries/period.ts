import {
  addDays,
  addMonths,
  daysBetween,
  isDay,
  localDay,
  localSecondOfDay,
  localToUtc,
  weekday,
} from "../../shared/time";

export interface Period {
  from: string;
  to: string;
  startMs: number;
  /** Fin exclusivo: si el periodo incluye hoy, es "ahora". */
  endMs: number;
  /** El periodo aún no ha terminado (incluye el día de hoy). */
  partial: boolean;
  days: number;
}

export interface ComparePeriod extends Period {
  label: string;
}

export class PeriodError extends Error {}

/** Valida y resuelve un rango de días locales a instantes UTC. */
export function resolvePeriod(from: string, to: string, now = Date.now()): Period {
  if (!isDay(from) || !isDay(to))
    throw new PeriodError("Fecha inexistente: usa el formato AAAA-MM-DD con un día real");
  const today = localDay(now);
  if (from > to) throw new PeriodError("La fecha inicial es posterior a la final");
  if (from > today) throw new PeriodError("El periodo empieza en el futuro");
  const end = to > today ? today : to;
  const days = daysBetween(from, end);
  if (days > 400) throw new PeriodError("El periodo máximo es de 400 días");
  const startMs = localToUtc(from);
  const fullEnd = localToUtc(addDays(end, 1));
  const partial = fullEnd > now;
  return { from, to: end, startMs, endMs: partial ? now : fullEnd, partial, days };
}

/**
 * Periodo con el que comparar. Un día se compara con el mismo día de la semana
 * anterior; un mes en curso, con el mismo tramo del mes anterior; el resto, con el
 * bloque inmediatamente anterior de la misma longitud. Si el periodo aún no ha
 * terminado, la comparación se corta a la misma hora del día para que sea justa.
 */
export function comparePeriod(p: Period, now = Date.now()): ComparePeriod {
  let shift: (d: string) => string;
  let label: string;
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  if (p.days === 1) {
    shift = (d) => addDays(d, -7);
    label = "mismo día de la semana pasada";
  } else if (p.from.endsWith("-01") && sameMonth) {
    shift = (d) => addMonths(d, -1);
    label = "mismo tramo del mes anterior";
  } else if (weekday(p.from) === 0 && p.days <= 7) {
    shift = (d) => addDays(d, -7);
    label = "semana anterior";
  } else {
    shift = (d) => addDays(d, -p.days);
    label = `${p.days} días anteriores`;
  }
  const from = shift(p.from);
  const to = shift(p.to);
  const startMs = localToUtc(from);
  const endMs = p.partial ? localToUtc(to, localSecondOfDay(now)) : localToUtc(addDays(to, 1));
  return { from, to, startMs, endMs, partial: p.partial, days: daysBetween(from, to), label };
}
