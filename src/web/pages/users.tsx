import { useState } from "react";
import type { SessionUser } from "../../shared/api";
import { IconAlert, IconX } from "../components/icons";
import { Empty, Skeleton } from "../components/ui";
import { useLeads, useUserMutation, useUsers } from "../lib/api";
import { relativeTime, useNow } from "../lib/hooks";

/** Quién puede entrar con Google. Solo para admins. */
export function UsersPage({ me }: { me: SessionUser }) {
  const q = useUsers(me.admin);
  const m = useUserMutation();
  const now = useNow(60_000);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "admin">("viewer");
  const domain = q.data?.domain ?? "4geeksacademy.com";

  if (!me.admin) {
    return (
      <div className="card">
        <Empty title="Solo los admins gestionan usuarios" />
      </div>
    );
  }

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Usuarios</h2>
        <span className="hint">Quién puede entrar con Google (solo cuentas @{domain})</span>
      </div>
      <div className="notice">
        <IconAlert />
        Quien entra con su email y contraseña de 4Geeks Center no necesita estar aquí: mantiene los permisos
        que tenga en Center.
      </div>
      <div className="card">
        <form
          className="users-add"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate({ kind: "add", email, role }, { onSuccess: () => setEmail("") });
          }}
        >
          <input
            className="input"
            type="email"
            required
            placeholder={`nombre@${domain}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email de la persona"
          />
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as "viewer" | "admin")}
            aria-label="Rol"
          >
            <option value="viewer">Lector · ve el panel</option>
            <option value="admin">Admin · ve y gestiona usuarios</option>
          </select>
          <button type="submit" className="btn primary" disabled={m.isPending}>
            Dar acceso
          </button>
        </form>
        {m.error ? (
          <div className="form-error" role="alert" style={{ margin: "12px 20px 0" }}>
            {m.error.message}
          </div>
        ) : null}
        {!q.data ? (
          <div style={{ padding: 20, display: "grid", gap: 10 }}>
            <Skeleton h={22} />
            <Skeleton h={22} />
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data calls">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Rol</th>
                  <th>Último acceso</th>
                  <th>Dado de alta por</th>
                  <th className="r" aria-label="Quitar" />
                </tr>
              </thead>
              <tbody>
                {q.data.users.map((u) => {
                  const self = u.email === me.email.toLowerCase();
                  return (
                    <tr key={u.email}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.name ?? u.email.split("@")[0]}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {u.email}
                        </div>
                      </td>
                      <td>
                        {u.fixed || self ? (
                          <span className={`tag ${u.role}`}>
                            {u.role === "admin" ? "Admin" : "Lector"}
                            {u.fixed ? " · fijo" : ""}
                          </span>
                        ) : (
                          <select
                            className="select role-select"
                            value={u.role}
                            aria-label={`Rol de ${u.email}`}
                            onChange={(e) =>
                              m.mutate({
                                kind: "role",
                                email: u.email,
                                role: e.target.value as "viewer" | "admin",
                              })
                            }
                          >
                            <option value="viewer">Lector</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </td>
                      <td className="muted">
                        {u.last_login_ms ? relativeTime(u.last_login_ms, now) : "Nunca"}
                      </td>
                      <td className="muted">
                        {u.added_by === "config" || u.fixed ? "Configuración" : (u.added_by ?? "—")}
                      </td>
                      <td className="r">
                        {u.fixed || self ? null : (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Quitar el acceso a ${u.email}`}
                            title="Quitar acceso"
                            onClick={() => {
                              if (window.confirm(`¿Quitar el acceso a ${u.email}? Se cerrará su sesión.`)) {
                                m.mutate({ kind: "remove", email: u.email });
                              }
                            }}
                          >
                            <IconX />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <LeadsSection />
    </>
  );
}

/** Solicitudes de acceso llegadas desde la landing (se guardan aunque el email falle). */
function LeadsSection() {
  const q = useLeads(true);
  const now = useNow(60_000);
  const leads = q.data?.leads ?? [];
  return (
    <>
      <div className="section-title">
        <h2>Solicitudes de la landing</h2>
        <span className="hint">
          {q.data?.notifyTo
            ? `Se avisan por email a ${q.data.notifyTo}; aquí quedan siempre`
            : "El aviso por email no está configurado; aquí quedan siempre"}
        </span>
      </div>
      <div className="card">
        {!q.data ? (
          <div style={{ padding: 20 }}>
            <Skeleton h={22} />
          </div>
        ) : leads.length === 0 ? (
          <Empty title="Todavía no hay solicitudes" />
        ) : (
          <div className="table-scroll">
            <table className="data calls">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Persona</th>
                  <th>Empresa</th>
                  <th>Equipo</th>
                  <th>Mensaje</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{relativeTime(l.created_ms, now)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.nombre}</div>
                      <a className="muted" style={{ fontSize: 12 }} href={`mailto:${l.email}`}>
                        {l.email}
                      </a>
                      {l.telefono ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {l.telefono}
                        </div>
                      ) : null}
                    </td>
                    <td>{l.empresa}</td>
                    <td className="muted">{l.comerciales}</td>
                    <td className="muted" style={{ whiteSpace: "normal", maxWidth: 320 }}>
                      {l.mensaje ?? "—"}
                    </td>
                    <td>
                      <span
                        className={`status-chip ${l.email_sent ? "ok" : "bad"}`}
                        title={l.email_error ?? undefined}
                      >
                        {l.email_sent ? "Enviado" : "Sin enviar"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
