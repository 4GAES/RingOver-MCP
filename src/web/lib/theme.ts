// Tema: por defecto el del sistema; si el usuario lo cambia, se recuerda en este navegador.
type Theme = "light" | "dark";

const KEY = "rg-theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function effectiveTheme(): Theme {
  const s = stored();
  if (s) return s;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyStoredTheme() {
  const s = stored();
  if (s) document.documentElement.dataset.theme = s;
}

export function toggleTheme(): Theme {
  const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // almacenamiento bloqueado: el cambio dura hasta recargar
  }
  return next;
}
