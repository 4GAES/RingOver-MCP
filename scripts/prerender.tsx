// Prerender de la landing: el HTML ya lleva todo el contenido, para Google y para los
// rastreadores de IA (GPTBot, ClaudeBot, PerplexityBot…), que no ejecutan JavaScript.
// Genera también las páginas legales, llms.txt y sitemap.xml desde los mismos textos.
import { readFileSync, writeFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { COMPANY, LEGAL_VERSION } from "../src/shared/legal";
import { METRICS } from "../src/shared/metrics";
import { Landing } from "../src/web/pages/landing";
import { FAQ, HOW_IT_WORKS, SITE } from "../src/web/pages/landing-content";
import { LegalPage } from "../src/web/pages/legal";
import { LEGAL_PAGES, LEGAL_SLUGS } from "../src/web/pages/legal-content";

const DIST = process.env.WEB_DIST ?? "dist/web";
const today = new Date().toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const body = renderToString(
  <QueryClientProvider client={new QueryClient()}>
    <Landing />
  </QueryClientProvider>,
);

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE.publisherUrl}/#org`,
      name: SITE.publisher,
      legalName: COMPANY.name,
      taxID: COMPANY.nif,
      url: SITE.publisherUrl,
      address: {
        "@type": "PostalAddress",
        streetAddress: "Calle Edison 3, Edificio Glue Work",
        postalCode: "28006",
        addressLocality: "Madrid",
        addressCountry: "ES",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#web`,
      url: `${SITE.url}/`,
      name: SITE.name,
      inLanguage: "es-ES",
      publisher: { "@id": `${SITE.publisherUrl}/#org` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE.url}/#app`,
      name: SITE.name,
      url: `${SITE.url}/`,
      description: SITE.description,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Analítica de llamadas",
      operatingSystem: "Web",
      inLanguage: "es-ES",
      image: `${SITE.url}/og.png`,
      publisher: { "@id": `${SITE.publisherUrl}/#org` },
      featureList: [
        ...METRICS.map((m) => m.label),
        "Jornada de cada comercial en tiempo real",
        "Alertas automáticas",
        "Servidor MCP para Claude, ChatGPT y Cursor",
      ],
      isRelatedTo: { "@type": "SoftwareApplication", name: "Ringover" },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE.url}/#faq`,
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

const head = `<meta name="description" content="${esc(SITE.description)}" />
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <link rel="canonical" href="${SITE.url}/" />
    <link rel="alternate" hreflang="es" href="${SITE.url}/" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="es_ES" />
    <meta property="og:site_name" content="${SITE.name}" />
    <meta property="og:title" content="${esc(SITE.title)}" />
    <meta property="og:description" content="${esc(SITE.description)}" />
    <meta property="og:url" content="${SITE.url}/" />
    <meta property="og:image" content="${SITE.url}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Ringover 4Geeks: analítica de llamadas e IA para Ringover" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(SITE.title)}" />
    <meta name="twitter:description" content="${esc(SITE.description)}" />
    <meta name="twitter:image" content="${SITE.url}/og.png" />
    <link rel="alternate" type="text/markdown" href="/llms.txt" title="Resumen para modelos de IA" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>
    <noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>`;

const template = readFileSync(`${DIST}/index.html`, "utf8");
const html = template
  .replace(/<title>.*?<\/title>/, `<title>${esc(SITE.title)}</title>`)
  .replace(/<meta name="robots"[^>]*>/, head)
  .replace('<div id="root"></div>', `<div id="root" data-landing="1">${body}</div>`);
if (!html.includes('data-landing="1"') || !html.includes("application/ld+json")) {
  throw new Error("El prerender no encontró dónde inyectar el contenido en index.html");
}
writeFileSync(`${DIST}/landing.html`, html);

// Páginas legales: mismo esqueleto, su propio título, descripción y canonical.
for (const slug of LEGAL_SLUGS) {
  const p = LEGAL_PAGES[slug];
  const url = `${SITE.url}/${slug}`;
  const title = `${p.title} | ${SITE.name}`;
  const legalBody = renderToString(<LegalPage slug={slug} />);
  const legalHead = `<meta name="description" content="${esc(p.description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="es_ES" />
    <meta property="og:site_name" content="${SITE.name}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(p.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${SITE.url}/og.png" />`;
  const legalHtml = template
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="robots"[^>]*>/, legalHead)
    .replace('<div id="root"></div>', `<div id="root" data-legal="${slug}">${legalBody}</div>`);
  if (!legalHtml.includes(`data-legal="${slug}"`)) throw new Error(`Prerender de /${slug} fallido`);
  writeFileSync(`${DIST}/legal-${slug}.html`, legalHtml);
}

writeFileSync(
  `${DIST}/llms.txt`,
  `# ${SITE.name}

> Analítica de llamadas e inteligencia artificial para equipos comerciales que usan Ringover. Producto independiente de ${SITE.publisher} que se conecta a la API pública de Ringover (no está afiliado a Ringover).

${SITE.description}

## Qué hace
${METRICS.map((m) => `- **${m.label}**: ${m.definition}`).join("\n")}
- **Jornada**: la línea de tiempo del día de cada comercial (tramos conectado, «no molestar» y cada llamada).
- **Alertas**: señales del día comparando a cada comercial con su propia media.
- **IA por MCP**: servidor MCP con 15 herramientas de solo lectura para Claude, ChatGPT y Cursor (OAuth o token personal). Responde por todo el equipo, por un comercial o por un grupo de comerciales elegido en la pregunta.
- **Selección de comerciales**: el panel y la IA se pueden limitar a varios comerciales a la vez.

## Cómo funciona
${HOW_IT_WORKS.map((s, i) => `${i + 1}. **${s.title}**: ${s.text}`).join("\n")}

## Preguntas frecuentes
${FAQ.map((f) => `### ${f.q}\n${f.a}`).join("\n\n")}

## Enlaces
- [Landing](${SITE.url}/)
- [Solicitar acceso](${SITE.url}/#acceso)
${LEGAL_SLUGS.map((s) => `- [${LEGAL_PAGES[s].title}](${SITE.url}/${s})`).join("\n")}

## Titular
${COMPANY.name} · NIF ${COMPANY.nif} · ${COMPANY.address} · ${COMPANY.email}
`,
);

writeFileSync(
  `${DIST}/sitemap.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE.url}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
${LEGAL_SLUGS.map((s) => `  <url><loc>${SITE.url}/${s}</loc><lastmod>${LEGAL_VERSION}</lastmod><changefreq>yearly</changefreq><priority>0.2</priority></url>`).join("\n")}
</urlset>
`,
);
console.log(
  `Landing prerenderizada (${Math.round(html.length / 1024)} KB), ${LEGAL_SLUGS.length} páginas legales, llms.txt y sitemap.xml listos.`,
);
