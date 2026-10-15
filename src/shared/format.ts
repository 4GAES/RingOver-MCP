import { weekday } from "./time";

const nf = new Intl.NumberFormat("es-ES");
const pf = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 0 });

export const fmtInt = (n: number) => nf.format(Math.round(n));
export const fmtPct = (r: number) => pf.format(r);

/** 4 h 12 min · 12 min 3 s · 45 s */
export function fmtDuration(seconds: number | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return opts.seconds !== false && m < 10 && r > 0 ? `${m} min ${r} s` : `${m} min`;
  return `${r} s`;
}

/** Duración compacta para tablas: 4:12 h · 12:03 */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}

export function fmtDelta(r: number): string {
  const sign = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${sign}${pf.format(Math.abs(r))}`;
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAYS_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dParts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, m, d };
};

/** "jueves 2 de octubre" */
export function fmtDayLong(day: string): string {
  const { m, d } = dParts(day);
  return `${WEEKDAYS[weekday(day)]} ${d} de ${MONTHS[m - 1]}`;
}

/** "jue 2 oct" */
export function fmtDayShort(day: string): string {
  const { m, d } = dParts(day);
  return `${WEEKDAYS_SHORT[weekday(day)]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "2 oct" */
export function fmtDayTiny(day: string): string {
  const { m, d } = dParts(day);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "2–8 oct" · "28 sep – 4 oct" */
export function fmtRange(from: string, to: string): string {
  if (from === to) return fmtDayShort(from);
  const a = dParts(from);
  const b = dParts(to);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]}`;
  return `${fmtDayTiny(from)} – ${fmtDayTiny(to)}`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Prefijos internacionales más habituales en el equipo; el más largo gana.
const PREFIXES: Record<string, [string, string]> = {
  "34": ["ES", "🇪🇸"],
  "1": ["US", "🇺🇸"],
  "1809": ["DO", "🇩🇴"],
  "1829": ["DO", "🇩🇴"],
  "1849": ["DO", "🇩🇴"],
  "1787": ["PR", "🇵🇷"],
  "1939": ["PR", "🇵🇷"],
  "52": ["MX", "🇲🇽"],
  "54": ["AR", "🇦🇷"],
  "56": ["CL", "🇨🇱"],
  "57": ["CO", "🇨🇴"],
  "58": ["VE", "🇻🇪"],
  "51": ["PE", "🇵🇪"],
  "593": ["EC", "🇪🇨"],
  "598": ["UY", "🇺🇾"],
  "595": ["PY", "🇵🇾"],
  "591": ["BO", "🇧🇴"],
  "506": ["CR", "🇨🇷"],
  "507": ["PA", "🇵🇦"],
  "502": ["GT", "🇬🇹"],
  "503": ["SV", "🇸🇻"],
  "504": ["HN", "🇭🇳"],
  "505": ["NI", "🇳🇮"],
  "53": ["CU", "🇨🇺"],
  "351": ["PT", "🇵🇹"],
  "33": ["FR", "🇫🇷"],
  "39": ["IT", "🇮🇹"],
  "44": ["GB", "🇬🇧"],
  "49": ["DE", "🇩🇪"],
  "41": ["CH", "🇨🇭"],
  "31": ["NL", "🇳🇱"],
  "32": ["BE", "🇧🇪"],
  "212": ["MA", "🇲🇦"],
  "55": ["BR", "🇧🇷"],
};

/** Agrupa de 3 en 3 sin dejar un dígito suelto al final: 222 488 9358 · 18 715 279 133 */
function groupDigits(d: string): string {
  const groups: string[] = [];
  let rest = d;
  if (rest.length % 3 === 2 && rest.length > 2) {
    groups.push(rest.slice(0, 2));
    rest = rest.slice(2);
  }
  while (rest.length > 4) {
    groups.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  if (rest) groups.push(rest);
  return groups.join(" ");
}

export interface PhoneView {
  flag: string;
  country: string | null;
  pretty: string;
}

/** Formatea un número en dígitos (E.164 sin "+") para mostrarlo con su bandera. */
export function fmtPhone(raw: string | null | undefined): PhoneView {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return { flag: "", country: null, pretty: "Número oculto" };
  if (digits.length === 9 && /^[6789]/.test(digits)) {
    return {
      flag: "🇪🇸",
      country: "ES",
      pretty: `${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`,
    };
  }
  for (const len of [4, 3, 2, 1]) {
    const hit = PREFIXES[digits.slice(0, len)];
    if (hit) {
      const rest = digits.slice(len);
      if (hit[0] === "ES" && rest.length === 9) {
        return {
          flag: hit[1],
          country: "ES",
          pretty: `+34 ${rest.slice(0, 3)} ${rest.slice(3, 5)} ${rest.slice(5, 7)} ${rest.slice(7)}`,
        };
      }
      const prefix = len === 4 ? digits.slice(0, 1) : digits.slice(0, len);
      const local = len === 4 ? digits.slice(1) : rest;
      return {
        flag: hit[1],
        country: hit[0],
        pretty: `+${prefix} ${groupDigits(local)}`,
      };
    }
  }
  return { flag: "", country: null, pretty: `+${digits}` };
}

/** Clave para casar un número escrito de formas distintas: últimos 9 dígitos. */
export function contactKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.length > 9 ? digits.slice(-9) : digits;
}
