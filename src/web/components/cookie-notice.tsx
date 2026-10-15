import { useEffect, useState } from "react";
import { LEGAL_VERSION } from "../../shared/legal";

// Aviso de cookies. Solo hay cookies técnicas (exentas de consentimiento, art. 22.2 LSSI-CE),
// así que es informativo: no hay nada que aceptar ni rechazar. Si algún día se añade
// analítica o publicidad, esto tiene que pasar a pedir permiso ANTES de cargarla.
const KEY = "rg-cookies";

export function CookieNotice() {
  // Se decide en el navegador, tras montar: el HTML prerenderizado no lo lleva.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== LEGAL_VERSION);
    } catch {
      setOpen(true);
    }
  }, []);
  if (!open) return null;

  const close = () => {
    try {
      localStorage.setItem(KEY, LEGAL_VERSION);
    } catch {
      // almacenamiento bloqueado: el aviso vuelve a salir la próxima vez
    }
    setOpen(false);
  };

  return (
    <section className="cookie-notice" aria-label="Aviso de cookies">
      <p>
        <b>Solo cookies técnicas.</b> Las justas para que puedas iniciar sesión y recordar tu tema. Sin
        analítica, sin publicidad y sin seguimiento.
      </p>
      <div className="cookie-actions">
        <a href="/cookies">Ver las cookies</a>
        <button type="button" className="lp-login" onClick={close}>
          Entendido
        </button>
      </div>
    </section>
  );
}
