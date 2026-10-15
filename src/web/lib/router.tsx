import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

// Enrutado mínimo con la History API: tres pantallas no justifican una librería.
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
if (typeof window !== "undefined") window.addEventListener("popstate", notify);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  history[opts.replace ? "replaceState" : "pushState"](null, "", to);
  notify();
  if (!opts.keepScroll && !opts.replace) window.scrollTo({ top: 0 });
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const url = new URL(href, location.origin);
  return { path: url.pathname, search: url.searchParams };
}

/** Cambia parámetros de la URL actual sin perder el resto. */
export function setParams(
  patch: Record<string, string | null | undefined>,
  opts: { replace?: boolean } = {},
) {
  const sp = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  // Las comas de las listas (?comerciales=1,2,3) se dejan legibles.
  const qs = sp.toString().replace(/%2C/gi, ",");
  navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: opts.replace ?? true, keepScroll: true });
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
