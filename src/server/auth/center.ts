import { z } from "zod";
import type { CenterUser } from "../../shared/api";
import { errMsg, log } from "../log";

// El acceso es el mismo que en 4Geeks Center (ControlTower): mismas cuentas, mismas
// contraseñas y mismos permisos. Esta app no guarda contraseñas: las valida Center.

export class CenterAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 502,
  ) {
    super(message);
  }
}

const meSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
});

export interface CenterOptions {
  baseUrl: string;
  callsSlug: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface CenterLogin {
  user: CenterUser;
  token: string;
  expiresMs: number;
}

/** Caduca igual que el token de Center (lo lleva en el JWT); por defecto 2 h. */
function tokenExpiry(token: string, now: number): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      exp?: number;
    };
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // token opaco: usamos el valor por defecto
  }
  return now + 2 * 3600_000;
}

export class CenterAuth {
  private readonly f: typeof fetch;
  private readonly timeout: number;

  constructor(private readonly o: CenterOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.timeout = o.timeoutMs ?? 8000;
  }

  private async call(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.token) headers.set("Cookie", `access_token=${init.token}`);
    // Un reintento solo ante fallo de red: Center vive en el mismo servidor.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.f(this.o.baseUrl.replace(/\/$/, "") + path, {
          ...init,
          headers,
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (e) {
        if (attempt >= 1) {
          log.error("Center no responde", { path, error: errMsg(e) });
          throw new CenterAuthError("No se puede contactar con 4Geeks Center", 502);
        }
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
      }
    }
  }

  async login(email: string, password: string, now = Date.now()): Promise<CenterLogin> {
    const res = await this.call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 401 || res.status === 422)
      throw new CenterAuthError("Email o contraseña incorrectos", 401);
    if (res.status === 403) throw new CenterAuthError("Tu cuenta de Center está desactivada", 403);
    if (!res.ok) throw new CenterAuthError("4Geeks Center no ha podido validar el acceso", 502);

    const cookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
    const token = cookies
      .map((c) => /(?:^|;\s*)access_token=([^;]+)/.exec(c)?.[1])
      .find((v): v is string => Boolean(v));
    if (!token) throw new CenterAuthError("4Geeks Center no devolvió sesión", 502);

    const user = await this.me(token);
    if (!user) throw new CenterAuthError("Email o contraseña incorrectos", 401);
    if (!(await this.canSeeCalls(token, user.role))) {
      throw new CenterAuthError("Tu usuario de Center no tiene acceso a los datos de llamadas", 403);
    }
    return { user, token, expiresMs: tokenExpiry(token, now) };
  }

  /** Usuario de la sesión de Center; null si el token ya no vale o la cuenta se desactivó. */
  async me(token: string): Promise<CenterUser | null> {
    const res = await this.call("/api/auth/me", { token });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new CenterAuthError("4Geeks Center no responde", 502);
    const parsed = meSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  }

  /**
   * Mismo permiso que en Center para ver llamadas: admin, o tener en el árbol de
   * dashboards el de contactabilidad (donde Center enseña las llamadas de Ringover).
   */
  async canSeeCalls(token: string, role: string): Promise<boolean> {
    if (role === "admin") return true;
    const res = await this.call("/api/dashboards/tree", { token });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(`"slug":"${this.o.callsSlug}"`) || text.includes(`"slug": "${this.o.callsSlug}"`);
  }

  /** ¿Center ya tiene el inicio de sesión único para esta app? (se consulta con caché). */
  async ssoAvailable(clientId: string, now = Date.now()): Promise<boolean> {
    if (this.ssoCache && now - this.ssoCache.at < 60_000) return this.ssoCache.ok;
    let ok = false;
    try {
      ok = (await this.call(`/api/auth/sso/clients/${encodeURIComponent(clientId)}`)).ok;
    } catch {
      ok = false;
    }
    this.ssoCache = { at: now, ok };
    return ok;
  }
  private ssoCache: { at: number; ok: boolean } | null = null;

  /**
   * Canjea el código que devuelve Center tras el inicio de sesión único (con PKCE) y
   * aplica el mismo permiso que el login con contraseña.
   */
  async exchangeSso(
    p: { clientId: string; redirectUri: string; code: string; verifier: string },
    now = Date.now(),
  ): Promise<CenterLogin> {
    const res = await this.call("/api/auth/sso/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: p.clientId,
        redirect_uri: p.redirectUri,
        code: p.code,
        code_verifier: p.verifier,
      }),
    });
    if (res.status === 403) throw new CenterAuthError("Tu cuenta de Center está desactivada", 403);
    if (!res.ok) throw new CenterAuthError("El acceso con Center ha caducado. Vuelve a intentarlo.", 401);
    const parsed = ssoTokenSchema.safeParse(await res.json());
    if (!parsed.success) throw new CenterAuthError("Respuesta inesperada de 4Geeks Center", 502);
    const { user, access_token } = parsed.data;
    if (!(await this.canSeeCalls(access_token, user.role))) {
      throw new CenterAuthError("Tu usuario de Center no tiene acceso a los datos de llamadas", 403);
    }
    return { user, token: access_token, expiresMs: tokenExpiry(access_token, now) };
  }
}

const ssoTokenSchema = z.object({ user: meSchema, access_token: z.string().min(10) });
