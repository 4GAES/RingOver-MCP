// Páginas legales: rutas, títulos y descripciones (también para el prerender y el sitemap).

export type LegalSlug = "aviso-legal" | "privacidad" | "cookies";

export const LEGAL_PAGES: Record<LegalSlug, { label: string; title: string; description: string }> = {
  "aviso-legal": {
    label: "Aviso legal",
    title: "Aviso legal",
    description:
      "Titular, condiciones de uso, propiedad intelectual y responsabilidad de Ringover 4Geeks, un producto de 4Geeks Academy España S.L.",
  },
  privacidad: {
    label: "Privacidad",
    title: "Política de privacidad",
    description:
      "Qué datos tratamos en Ringover 4Geeks, para qué, durante cuánto tiempo y cómo ejercer tus derechos (RGPD y LOPDGDD).",
  },
  cookies: {
    label: "Cookies",
    title: "Política de cookies",
    description:
      "Ringover 4Geeks solo usa cookies técnicas propias: sin analítica, sin publicidad y sin seguimiento. Aquí están todas, con su duración.",
  },
};

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES) as LegalSlug[];

export function legalSlug(path: string): LegalSlug | null {
  const slug = path.replace(/^\/|\/$/g, "");
  return slug in LEGAL_PAGES ? (slug as LegalSlug) : null;
}

/** Todo lo que el sitio guarda en el navegador. Si se añade algo, va aquí (y en la política). */
export const STORAGE_ITEMS: { name: string; kind: string; purpose: string; duration: string }[] = [
  {
    name: "rg_sid",
    kind: "Cookie propia · técnica",
    purpose: "Mantiene tu sesión iniciada en el panel. Solo existe después de entrar.",
    duration: "Hasta que cierras sesión o caduca (horas)",
  },
  {
    name: "rg_g",
    kind: "Cookie propia · técnica",
    purpose: "Protege el inicio de sesión con Google frente a suplantaciones.",
    duration: "10 minutos",
  },
  {
    name: "rg_sso",
    kind: "Cookie propia · técnica",
    purpose: "Protege el inicio de sesión con 4Geeks Center.",
    duration: "10 minutos",
  },
  {
    name: "rg_csrf",
    kind: "Cookie propia · técnica",
    purpose: "Protege la autorización cuando conectas una IA (Claude, ChatGPT…).",
    duration: "15 minutos",
  },
  {
    name: "rg_next",
    kind: "Cookie propia · técnica",
    purpose: "Recuerda a qué paso volver después de entrar para conectar una IA.",
    duration: "15 minutos",
  },
  {
    name: "rg-theme",
    kind: "Almacenamiento local · personalización",
    purpose: "Recuerda el tema claro u oscuro que eliges.",
    duration: "Hasta que lo borres",
  },
  {
    name: "rg-cookies",
    kind: "Almacenamiento local · técnico",
    purpose: "Recuerda que ya has leído el aviso de cookies.",
    duration: "Hasta que lo borres",
  },
];
