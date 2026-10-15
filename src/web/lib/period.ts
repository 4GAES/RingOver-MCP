import { addDays, isDay, localDay, startOfMonth, startOfWeek } from "../../shared/time";
import { setParams, useLocation } from "./router";
import { currentSelectionParam } from "./selection";

export type Preset = "hoy" | "ayer" | "semana" | "mes" | "30d";

export const PRESETS: { key: Preset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "ayer", label: "Ayer" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mes" },
  { key: "30d", label: "30 días" },
];

export function presetRange(p: Preset, today: string): [string, string] {
  switch (p) {
    case "hoy":
      return [today, today];
    case "ayer":
      return [addDays(today, -1), addDays(today, -1)];
    case "semana":
      return [startOfWeek(today), today];
    case "mes":
      return [startOfMonth(today), today];
    case "30d":
      return [addDays(today, -29), today];
  }
}

export function presetOf(from: string, to: string, today: string): Preset | null {
  for (const p of PRESETS) {
    const [f, t] = presetRange(p.key, today);
    if (f === from && t === to) return p.key;
  }
  return null;
}

export const today = () => localDay(Date.now());

export function usePeriod() {
  const { search } = useLocation();
  const t = today();
  let from = search.get("desde");
  let to = search.get("hasta");
  if (!isDay(from)) from = isDay(to) ? to : t;
  if (!isDay(to)) to = from;
  if (to > t) to = t;
  if (from > to) from = to;
  const single = from === to;
  return {
    from,
    to,
    today: t,
    single,
    preset: presetOf(from, to, t),
    setRange(f: string, tt: string) {
      setParams({ desde: f === t && tt === t ? null : f, hasta: f === tt ? null : tt }, { replace: false });
    },
    setPreset(p: Preset) {
      const [f, tt] = presetRange(p, t);
      setParams({ desde: f === t && tt === t ? null : f, hasta: f === tt ? null : tt }, { replace: false });
    },
    step(dir: -1 | 1) {
      if (!single) return;
      const next = addDays(from, dir);
      if (next > t) return;
      setParams({ desde: next === t ? null : next, hasta: null });
    },
  };
}

/** Parámetros para enlazar a otra pantalla manteniendo el periodo y la selección de comerciales. */
export function periodQuery(from: string, to: string, t = today()): string {
  const sp = new URLSearchParams();
  if (!(from === t && to === t)) sp.set("desde", from);
  if (to !== from) sp.set("hasta", to);
  const sel = currentSelectionParam();
  if (sel) sp.set("comerciales", sel);
  const s = sp.toString().replace(/%2C/gi, ",");
  return s ? `?${s}` : "";
}
