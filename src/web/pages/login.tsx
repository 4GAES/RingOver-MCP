import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "../components/brand";
import { GoogleG } from "../components/google";
import { IconX } from "../components/icons";
import { useAuthOptions, useLogin } from "../lib/api";

/** Error que devuelve la vuelta desde Google o Center (?sso_error=…); se limpia de la URL al leerlo. */
export function takeLoginError(): string | null {
  const sp = new URLSearchParams(location.search);
  const msg = sp.get("sso_error");
  if (msg) {
    sp.delete("sso_error");
    const qs = sp.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
  }
  return msg;
}

/** El acceso: Google (cuentas de 4Geeks) o email y contraseña de 4Geeks Center. */
export function LoginCard({
  initialError,
  connecting,
}: {
  initialError: string | null;
  connecting: string | null;
}) {
  const login = useLogin();
  const options = useAuthOptions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const o = options.data;
  const error = login.error?.message ?? initialError;

  return (
    <div className="login-card">
      <div className="login-brand">
        <BrandLogo height={58} />
      </div>
      <h2 className="login-title" id="login-title">
        Entra en tu panel
      </h2>
      <p className="lead">Con tu cuenta de 4Geeks. Mismos permisos que en 4Geeks Center.</p>
      {connecting ? (
        <p className="login-notice">
          Entra para conectar <b>{connecting}</b> con tus datos de llamadas.
        </p>
      ) : null}

      {o?.google ? (
        <a className="btn google-btn" href="/auth/google">
          <GoogleG />
          Continuar con Google
        </a>
      ) : null}
      {o?.sso ? (
        <a className="btn google-btn" href="/auth/center" style={{ marginTop: 10 }}>
          <span className="center-mark" aria-hidden="true">
            4G
          </span>
          Entrar con 4Geeks Center
        </a>
      ) : null}
      {o?.google || o?.sso ? <div className="or-sep">o con tu email</div> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password });
        }}
      >
        <label className="field">
          Email de 4Geeks Center
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Contraseña
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? (
          <div className="form-error" role="alert">
            {error}
          </div>
        ) : null}
        <button type="submit" className="btn primary login-primary" disabled={login.isPending}>
          {login.isPending ? "Entrando…" : "Entrar al panel"}
        </button>
      </form>

      {o?.google ? (
        <p className="login-foot">
          Con Google, solo cuentas @{o.domain ?? "4geeksacademy.com"} dadas de alta.
        </p>
      ) : null}
      <p className="login-legal">
        <a href="/privacidad" target="_blank" rel="noopener">
          Privacidad
        </a>
        <span aria-hidden="true">·</span>
        <a href="/cookies" target="_blank" rel="noopener">
          Cookies
        </a>
      </p>
    </div>
  );
}

/** El login en una ventana sobre la landing (se abre desde la cabecera). */
export function LoginModal({
  onClose,
  initialError,
  connecting,
}: {
  onClose: () => void;
  initialError: string | null;
  connecting: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("a.google-btn, input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="login-overlay">
      <div className="login-overlay-back" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="card login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
      >
        <button type="button" className="icon-btn login-close" onClick={onClose} aria-label="Cerrar">
          <IconX />
        </button>
        <LoginCard initialError={initialError} connecting={connecting} />
      </div>
    </div>
  );
}
