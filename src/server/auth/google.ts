import { z } from "zod";
import { errMsg, log } from "../log";

// Login con Google (OpenID Connect, código + PKCE + nonce). El id_token llega directo
// del endpoint de tokens de Google por TLS, así que basta con comprobar sus campos
// (OIDC Core 3.1.3.7): emisor, audiencia, caducidad, nonce, email verificado y dominio.

export class GoogleAuthError extends Error {}

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  allowedDomain: string;
  authUrl: string;
  tokenUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  email: z.string(),
  email_verified: z.boolean().optional(),
  hd: z.string().optional(),
  nonce: z.string().optional(),
  name: z.string().optional(),
});

export interface GoogleIdentity {
  email: string;
  name: string | null;
}

export class GoogleAuth {
  private readonly f: typeof fetch;

  constructor(private readonly o: GoogleOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  get enabled(): boolean {
    return Boolean(this.o.clientId && this.o.clientSecret);
  }

  authorizeUrl(p: { redirectUri: string; state: string; challenge: string; nonce: string }): string {
    const url = new URL(this.o.authUrl);
    url.search = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: p.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: p.state,
      nonce: p.nonce,
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      hd: this.o.allowedDomain,
      prompt: "select_account",
    }).toString();
    return url.toString();
  }

  async exchange(
    p: { code: string; verifier: string; redirectUri: string; nonce: string },
    now = Date.now(),
  ): Promise<GoogleIdentity> {
    const body = new URLSearchParams({
      code: p.code,
      client_id: this.o.clientId,
      client_secret: this.o.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: "authorization_code",
      code_verifier: p.verifier,
    });
    let res: Response | null = null;
    // Un reintento ante fallo de red o 5xx de Google; el código solo vale una vez,
    // pero si Google no llegó a procesarlo sigue siendo válido.
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        const r = await this.f(this.o.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
        });
        if (r.status >= 500 && attempt === 0) {
          await new Promise((ok) => setTimeout(ok, 400 + Math.random() * 400));
          continue;
        }
        res = r;
      } catch (e) {
        log.warn("google token: fallo de red", { error: errMsg(e) });
        if (attempt === 1)
          throw new GoogleAuthError("No se puede contactar con Google. Vuelve a intentarlo.");
      }
    }
    if (!res?.ok) throw new GoogleAuthError("Google no ha aceptado el acceso. Vuelve a intentarlo.");
    const json = (await res.json().catch(() => ({}))) as { id_token?: string };
    const claims = claimsSchema.safeParse(decodeJwtPayload(json.id_token ?? ""));
    if (!claims.success) throw new GoogleAuthError("Respuesta inesperada de Google");
    const c = claims.data;
    const domain = this.o.allowedDomain.toLowerCase();
    const email = c.email.toLowerCase();
    if (
      !["accounts.google.com", "https://accounts.google.com"].includes(c.iss) ||
      c.aud !== this.o.clientId
    ) {
      throw new GoogleAuthError("Respuesta de Google no válida");
    }
    if (c.exp * 1000 < now - 60_000) throw new GoogleAuthError("El acceso con Google ha caducado");
    if (c.nonce !== p.nonce)
      throw new GoogleAuthError("El acceso con Google no coincide. Vuelve a intentarlo.");
    if (c.email_verified !== true) throw new GoogleAuthError("Tu email de Google no está verificado");
    if (c.hd?.toLowerCase() !== domain || !email.endsWith(`@${domain}`)) {
      throw new GoogleAuthError(`Entra con tu cuenta de @${domain} (no con una personal)`);
    }
    return { email, name: c.name ?? null };
  }
}

function decodeJwtPayload(token: string): unknown {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
