import { useEffect, useRef, useState } from "react";
import { effectiveTheme, toggleTheme } from "../lib/theme";
import { BrandLogo } from "./brand";
import { IconMenu, IconMoon, IconSun, IconX } from "./icons";

// Cabecera de la landing y de las páginas legales. En pantallas estrechas, la navegación,
// «Entrar» y el tema pasan a un menú desplegable; «Solicitar acceso» se queda siempre a la vista.
// Se renderiza también en el servidor: nada de window en el render.

const isBrowser = typeof window !== "undefined";
const SECTIONS = [
  ["como-funciona", "Cómo funciona"],
  ["producto", "Métricas"],
  ["ia", "IA"],
  ["preguntas", "Preguntas"],
] as const;

export function SiteHeader({ home, onLogin }: { home: boolean; onLogin?: () => void }) {
  const [theme, setTheme] = useState<"light" | "dark">(() => (isBrowser ? effectiveTheme() : "dark"));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const at = (id: string) => `${home ? "" : "/"}#${id}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const themeLabel = theme === "dark" ? "Usar tema claro" : "Usar tema oscuro";
  const switchTheme = () => setTheme(toggleTheme());
  const login = (className: string, label = "Entrar") =>
    onLogin ? (
      <button
        type="button"
        className={className}
        onClick={() => {
          setOpen(false);
          onLogin();
        }}
      >
        {label}
      </button>
    ) : (
      <a className={className} href="/#entrar">
        {label}
      </a>
    );

  return (
    <header ref={ref} className={`lp-header${open ? " is-open" : ""}`}>
      <div className="lp-wrap lp-header-row">
        <a href="/" className="lp-brand" aria-label="Ringover 4Geeks, inicio">
          <BrandLogo height={34} />
        </a>
        <nav className="lp-nav" aria-label="Contenido de la página">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={at(id)}>
              {label}
            </a>
          ))}
        </nav>
        <div className="lp-actions">
          <button type="button" className="icon-btn lp-wide" onClick={switchTheme} aria-label={themeLabel}>
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          {login("lp-login ghost lp-wide")}
          <a className="lp-login" href={at("acceso")}>
            Solicitar acceso
          </a>
          <button
            type="button"
            className="icon-btn lp-menu-btn"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
        </div>
      </div>
      <div id="lp-menu" className="lp-menu" hidden={!open}>
        <nav className="lp-wrap" aria-label="Menú">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={at(id)} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <div className="lp-menu-actions">
            {login("lp-btn ghost", "Entrar al panel")}
            <button type="button" className="lp-btn ghost" onClick={switchTheme}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
              {theme === "dark" ? "Tema claro" : "Tema oscuro"}
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
