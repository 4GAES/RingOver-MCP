import { useEffect } from "react";
import { setParams, useLocation } from "./router";

// Selección de comerciales del panel (Resumen y Llamadas). Vive en la URL (?comerciales=1,2,3)
// para poder compartirla, y este navegador recuerda la última: al volver al panel sin
// selección en la URL se aplica la guardada. Vacía = todo el equipo.

const KEY = "rg-comerciales";
const VALID = /^\d{1,12}(,\d{1,12})*$/;

const parse = (raw: string | null | undefined): number[] =>
  raw && VALID.test(raw) ? [...new Set(raw.split(",").map(Number))] : [];

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // almacenamiento bloqueado: la selección dura lo que la URL
  }
}

export function forgetSelection() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nada que borrar
  }
}

/** La selección vigente: la de la URL o, si no trae ninguna, la última guardada. */
function effective(search: URLSearchParams): number[] {
  return search.has("comerciales") ? parse(search.get("comerciales")) : parse(stored());
}

/** Para enlaces entre pantallas (sin hook): la selección vigente como "1,2,3" o "". */
export function currentSelectionParam(): string {
  if (typeof window === "undefined") return "";
  return effective(new URLSearchParams(location.search)).join(",");
}

export function useSelection() {
  const { search } = useLocation();
  const ids = effective(search);
  const key = ids.join(",");
  const inUrl = search.has("comerciales");

  // Si la selección viene de lo guardado, se refleja en la URL (sin nueva entrada en el historial).
  useEffect(() => {
    if (!inUrl && key) setParams({ comerciales: key }, { replace: true });
  }, [inUrl, key]);

  return {
    ids,
    /** "1,2,3" para la API y las claves de caché ("" = todo el equipo). */
    key,
    set(next: number[]) {
      const v = [...new Set(next)].sort((a, b) => a - b).join(",");
      remember(v);
      setParams({ comerciales: v || null }, { replace: false });
    },
  };
}
