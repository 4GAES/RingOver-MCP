import { useRef, useState } from "react";
import type { SessionUser } from "../../shared/api";
import { useLive, useLogout, useSyncNow } from "../lib/api";
import { relativeTime, useDismiss, useNow } from "../lib/hooks";
import { periodQuery, usePeriod } from "../lib/period";
import { Link, useLocation } from "../lib/router";
import { effectiveTheme, toggleTheme } from "../lib/theme";
import { BrandLogo, BrandMarkLogo } from "./brand";
import { IconLogout, IconMoon, IconRefresh, IconSun } from "./icons";
import { Avatar, liveLabel, StatusDot } from "./ui";

export function TopBar({ user }: { user: SessionUser }) {
  const { path } = useLocation();
  const p = usePeriod();
  const live = useLive();
  const sync = useSyncNow();
  const logout = useLogout();
  const now = useNow(15_000);
  const [theme, setTheme] = useState(effectiveTheme());
  const [menu, setMenu] = useState<"live" | "user" | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  useDismiss(liveRef, menu === "live", () => setMenu(null));
  useDismiss(userRef, menu === "user", () => setMenu(null));

  const agents = live.data?.agents ?? [];
  const connected = agents.filter((a) => a.live.fresh && a.live.connected).length;
  const inCall = agents.filter((a) => a.live.fresh && a.live.inCall).length;
  const synced = live.data?.status.callsSyncedMs ?? null;
  const stale = synced !== null && now - synced > 30 * 60_000;
  const q = periodQuery(p.from, p.to);
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="wrap">
        <Link href={`/${q}`} className="brand" aria-label="Inicio · Ringover 4Geeks">
          <span className="brand-full">
            <BrandLogo height={34} />
          </span>
          <span className="brand-compact">
            <BrandMarkLogo size={26} />
          </span>
          <span className="brand-scope">España</span>
        </Link>
        <nav className="nav" aria-label="Secciones">
          <Link
            href={`/${q}`}
            aria-current={path === "/" || path.startsWith("/comercial") ? "page" : undefined}
          >
            Resumen
          </Link>
          <Link href={`/llamadas${q}`} aria-current={path === "/llamadas" ? "page" : undefined}>
            Llamadas
          </Link>
          <Link href="/ia" aria-current={path === "/ia" ? "page" : undefined}>
            IA
          </Link>
          {user.admin ? (
            <Link href="/usuarios" aria-current={path === "/usuarios" ? "page" : undefined}>
              Usuarios
            </Link>
          ) : null}
        </nav>

        <div className="topbar-right">
          <div className="pop-anchor" ref={liveRef}>
            <button
              type="button"
              className="live-pill"
              aria-expanded={menu === "live"}
              onClick={() => setMenu((m) => (m === "live" ? null : "live"))}
            >
              <span className={`dot ${connected ? "ok pulse" : ""}`} />
              <strong className="num">{connected}</strong>
              <span className="label-long">conectados</span>
              {inCall ? (
                <>
                  <span aria-hidden="true">·</span>
                  <strong className="num">{inCall}</strong>
                  <span className="label-long">en llamada</span>
                </>
              ) : null}
            </button>
            {menu === "live" ? (
              <div className="popover">
                <div className="pop-head">Equipo ahora mismo</div>
                {agents.length === 0 ? (
                  <div className="pop-row muted">Nadie conectado</div>
                ) : (
                  agents.map((a) => (
                    <Link
                      key={a.agent.id}
                      href={`/comercial/${a.agent.id}${q}`}
                      className="pop-row"
                      onClick={() => setMenu(null)}
                    >
                      <StatusDot live={a.live} />
                      <span className="grow">
                        {a.agent.name}
                        <span className="sub">{liveLabel(a.live, now).text}</span>
                      </span>
                      <span className="num muted">{a.today.llamadas}</span>
                    </Link>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <span className={`fresh${stale ? " warn" : ""}`} title="Última sincronización con Ringover">
            {synced ? `Actualizado ${relativeTime(synced, now)}` : "Sin sincronizar"}
          </span>
          <button
            type="button"
            className={`icon-btn desktop-only${sync.isPending ? " spin" : ""}`}
            onClick={() => sync.mutate()}
            aria-label="Traer las últimas llamadas de Ringover"
            title="Actualizar ahora"
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="icon-btn desktop-only"
            onClick={() => setTheme(toggleTheme())}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
          >
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </button>
          <div className="pop-anchor" ref={userRef}>
            <button
              type="button"
              className="icon-btn"
              aria-label="Tu cuenta"
              aria-expanded={menu === "user"}
              onClick={() => setMenu((m) => (m === "user" ? null : "user"))}
            >
              <span className="avatar me">{initials}</span>
            </button>
            {menu === "user" ? (
              <div className="popover">
                <div className="pop-row">
                  <span className="grow">
                    <b>{user.name}</b>
                    <span className="sub">{user.email}</span>
                    <span className="sub">
                      {user.admin ? "Admin" : "Lector"} ·{" "}
                      {user.provider === "google" ? "entró con Google" : "cuenta de Center"}
                    </span>
                  </span>
                </div>
                <div className="pop-sep" />
                <button type="button" className="pop-row mobile-only" onClick={() => sync.mutate()}>
                  <IconRefresh width={16} height={16} /> Actualizar ahora
                  <span className="sub" style={{ marginLeft: "auto" }}>
                    {synced ? relativeTime(synced, now) : ""}
                  </span>
                </button>
                <button type="button" className="pop-row mobile-only" onClick={() => setTheme(toggleTheme())}>
                  {theme === "dark" ? (
                    <IconSun width={16} height={16} />
                  ) : (
                    <IconMoon width={16} height={16} />
                  )}
                  {theme === "dark" ? "Tema claro" : "Tema oscuro"}
                </button>
                <button type="button" className="pop-row" onClick={() => logout.mutate()}>
                  <IconLogout width={16} height={16} /> Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
