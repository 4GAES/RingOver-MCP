import { randomBytes } from "node:crypto";
import type { SessionUser } from "../../shared/api";
import type { DB } from "../db";
import { errMsg, log } from "../log";
import type { CenterAuth, CenterLogin } from "./center";
import type { Users } from "./users";

export const COOKIE = "rg_sid";
/** Cada cuánto se vuelve a comprobar que la cuenta sigue teniendo acceso. */
const RECHECK_MS = 5 * 60_000;
/** Una sesión de Google dura una jornada; las de Center, lo que dure su token (2 h). */
export const GOOGLE_SESSION_MS = 12 * 3600_000;

export type Provider = "center" | "google";

interface SessionRow {
  id: string;
  center_token: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  provider: Provider;
  expires_ms: number;
  checked_ms: number;
}

const toUser = (r: Pick<SessionRow, "user_id" | "email" | "name" | "role" | "provider">): SessionUser => ({
  id: r.user_id,
  email: r.email,
  name: r.name,
  role: r.role,
  provider: r.provider,
  admin: r.role === "admin",
});

export class Sessions {
  constructor(
    private readonly db: DB,
    private readonly center: Pick<CenterAuth, "me">,
    private readonly users: Users,
  ) {}

  create(
    login: CenterLogin | { user: Omit<SessionUser, "admin" | "provider">; token: ""; expiresMs: number },
    now = Date.now(),
    provider: Provider = "center",
  ): { id: string; maxAgeS: number } {
    const id = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        `INSERT INTO sessions (id, center_token, user_id, email, name, role, created_ms, expires_ms, checked_ms, provider)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        login.token,
        login.user.id,
        login.user.email,
        login.user.name,
        login.user.role,
        now,
        login.expiresMs,
        now,
        provider,
      );
    this.db.prepare("DELETE FROM sessions WHERE expires_ms < ?").run(now);
    return { id, maxAgeS: Math.max(60, Math.floor((login.expiresMs - now) / 1000)) };
  }

  destroy(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** Usuario de la sesión; revalida cada pocos minutos (contra Center o contra la lista). */
  async get(id: string | undefined, now = Date.now()): Promise<SessionUser | null> {
    if (!id) return null;
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
    if (!row) return null;
    if (row.expires_ms <= now) {
      this.destroy(id);
      return null;
    }
    if (now - row.checked_ms <= RECHECK_MS) return toUser(row);

    if (row.provider === "google") {
      // Si un admin le quita el acceso o le cambia el rol, se aplica en pocos minutos.
      const role = this.users.access(row.email);
      if (!role) {
        this.destroy(id);
        return null;
      }
      this.db.prepare("UPDATE sessions SET checked_ms = ?, role = ? WHERE id = ?").run(now, role, id);
      return toUser({ ...row, role });
    }

    try {
      const user = await this.center.me(row.center_token);
      if (!user) {
        this.destroy(id);
        return null;
      }
      this.db
        .prepare("UPDATE sessions SET checked_ms = ?, name = ?, role = ?, email = ? WHERE id = ?")
        .run(now, user.name, user.role, user.email, id);
      return toUser({ ...row, ...user, user_id: user.id });
    } catch (e) {
      // Si Center no responde un momento, no echamos a nadie: se reintenta en la próxima.
      log.warn("no se pudo revalidar la sesión", { error: errMsg(e) });
      return toUser(row);
    }
  }

  /** Cierra las sesiones de Google de una cuenta (al quitarle el acceso). */
  destroyGoogleFor(email: string) {
    this.db.prepare("DELETE FROM sessions WHERE provider = 'google' AND email = ?").run(email.toLowerCase());
  }
}
