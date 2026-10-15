import { LEGAL_PAGES, LEGAL_SLUGS, type LegalSlug } from "../pages/legal-content";

// Insignia "Destroy this website" de Sprite Fusion (solo en la landing pública).
// La versión clara se ve en el tema claro y la oscura en el oscuro (sigue al tema del panel).
// Carga diferida: la imagen (de un tercero) solo se pide si llegas al pie.
const BADGE = "https://destroy.spritefusion.com";

export function DestroyBadge() {
  const origin = typeof location !== "undefined" ? location.origin : "https://ringover.duckdns.org";
  const href = `${BADGE}/?from=badge&url=${encodeURIComponent(origin)}`;
  return (
    <a className="destroy-badge" href={href} target="_blank" rel="noopener noreferrer">
      <img
        className="badge-for-light"
        src={`${BADGE}/badge-light.svg`}
        alt="Destroy this website"
        width="135"
        height="30"
        loading="lazy"
      />
      <img
        className="badge-for-dark"
        src={`${BADGE}/badge.svg`}
        alt="Destroy this website"
        width="135"
        height="30"
        loading="lazy"
      />
    </a>
  );
}

/** Pie de la landing y de las páginas legales. */
export function SiteFooter({ current, badge = false }: { current?: LegalSlug; badge?: boolean }) {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <span className="lp-made">
          Un producto de <b>4Geeks Academy</b> · Hecho en Madrid
        </span>
        <nav className="lp-legal-links" aria-label="Información legal">
          {LEGAL_SLUGS.map((s) => (
            <a key={s} href={`/${s}`} aria-current={s === current ? "page" : undefined}>
              {LEGAL_PAGES[s].label}
            </a>
          ))}
        </nav>
        <p className="lp-legal">
          Ringover es una marca de su respectivo titular. Ringover 4Geeks es un producto independiente que se
          conecta a la API pública de Ringover; no está afiliado ni respaldado por Ringover.
        </p>
        {badge ? (
          <>
            <span className="lp-dare">¿Te atreves a romperla?</span>
            <DestroyBadge />
          </>
        ) : null}
      </div>
    </footer>
  );
}
