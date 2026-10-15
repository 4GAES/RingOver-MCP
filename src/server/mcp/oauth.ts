import { createHash, randomBytes } from "node:crypto";
import type { Context, Env, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { SessionUser } from "../../shared/api";
import { COOKIE, type Sessions } from "../auth/sessions";
import { type ApiTokens, sha256 } from "../auth/tokens";
import type { DB } from "../db";
import { log } from "../log";

// Servidor de autorización OAuth 2.1 para el MCP (especificación de autorización de
// MCP): descubrimiento (RFC 9728 + RFC 8414), registro dinámico de clientes (RFC 7591),
// código de autorización con PKCE S256 y refresh tokens que rotan. Quien autoriza es la
// persona con su sesión del panel (Google o Center): el token actúa con sus permisos.

export const SCOPE = "llamadas:leer";
const CODE_TTL_MS = 10 * 60_000;
export const NEXT_COOKIE = "rg_next";
const CSRF_COOKIE = "rg_csrf";

export interface OAuthDeps {
  db: DB;
  tokens: ApiTokens;
  sessions: Sessions;
  publicUrl: string;
  cookieSecure: boolean;
  now: () => number;
}

interface ClientRow {
  client_id: string;
  name: string;
  redirect_uris: string;
}

const BLOCKED_SCHEMES = new Set(["javascript", "data", "vbscript", "file", "blob"]);

/** URLs de vuelta admitidas: https, http solo a la propia máquina, o esquemas de apps nativas. */
export function validRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const scheme = u.protocol.replace(":", "").toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme) || u.hash) return false;
  if (scheme === "https") return true;
  if (scheme === "http") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const authorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(500),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(500).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(500).optional(),
});

export function registerOAuth<E extends Env>(app: Hono<E>, d: OAuthDeps) {
  const base = d.publicUrl.replace(/\/$/, "");
  const resource = `${base}/mcp`;

  const protectedResource = (c: Context) =>
    c.json({
      resource,
      authorization_servers: [base],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Ringover 4Geeks · Llamadas España",
      resource_documentation: `${base}/ia`,
    });
  app.get("/.well-known/oauth-protected-resource", protectedResource);
  app.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

  const asMetadata = (c: Context) =>
    c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
      service_documentation: `${base}/ia`,
    });
  app.get("/.well-known/oauth-authorization-server", asMetadata);
  app.get("/.well-known/oauth-authorization-server/mcp", asMetadata);
  app.get("/.well-known/openid-configuration", asMetadata);

  // ── Registro dinámico de clientes ────────────────────────────────────────
  app.post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      redirect_uris?: unknown;
      client_name?: unknown;
    } | null;
    const uris = Array.isArray(body?.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === "string")
      : [];
    if (!uris.length || uris.length > 10 || !uris.every(validRedirectUri)) {
      return c.json({ error: "invalid_redirect_uri", error_description: "redirect_uris no válidas" }, 400);
    }
    const name = (typeof body?.client_name === "string" ? body.client_name : "Aplicación MCP")
      .trim()
      .slice(0, 100);
    const clientId = `mcp_${randomBytes(12).toString("base64url")}`;
    const now = d.now();
    d.db
      .prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_ms) VALUES (?, ?, ?, ?)")
      .run(clientId, name, JSON.stringify(uris), now);
    log.info("oauth: cliente registrado", { client: name });
    return c.json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(now / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201,
    );
  });

  const client = (id: string) =>
    (d.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(id) as ClientRow | undefined) ??
    null;

  /** Valida la petición; si la URL de vuelta no es de fiar, se muestra el error aquí y no se redirige. */
  function validate(params: Record<string, string>) {
    const parsed = authorizeQuery.safeParse(params);
    const cl = client(params.client_id ?? "");
    const uris: string[] = cl ? JSON.parse(cl.redirect_uris) : [];
    if (!cl || !params.redirect_uri || !uris.includes(params.redirect_uri)) {
      return {
        kind: "err",
        error: "Aplicación desconocida o URL de vuelta no registrada.",
        redirect: null,
      } as const;
    }
    if (!parsed.success) {
      return {
        kind: "err",
        error: "Petición de autorización incompleta (falta PKCE S256).",
        redirect: params.redirect_uri,
      } as const;
    }
    const res = parsed.data.resource?.replace(/\/$/, "");
    if (res && res !== resource && res !== base) {
      return {
        kind: "err",
        error: "Este servidor no sirve ese recurso.",
        redirect: params.redirect_uri,
      } as const;
    }
    return { kind: "ok", ok: parsed.data, client: cl } as const;
  }

  const back = (redirectUri: string, params: Record<string, string | undefined>) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  };

  async function sessionUser(c: Context): Promise<SessionUser | null> {
    return d.sessions.get(getCookie(c, COOKIE), d.now());
  }

  app.get("/oauth/authorize", async (c) => {
    const params = c.req.query();
    const v = validate(params);
    if (v.kind === "err") {
      if (v.redirect)
        return c.redirect(
          back(v.redirect, { error: "invalid_request", error_description: v.error, state: params.state }),
          302,
        );
      return page(c, errorPage(v.error), null, 400);
    }
    const user = await sessionUser(c);
    if (!user) {
      // Sin sesión: primero el login del panel (Google o Center) y luego se vuelve aquí.
      setCookie(c, NEXT_COOKIE, c.req.url.replace(/^https?:\/\/[^/]+/, ""), {
        httpOnly: true,
        secure: d.cookieSecure,
        sameSite: "Lax",
        path: "/",
        maxAge: 900,
      });
      return c.redirect(`/?conectar=${encodeURIComponent(v.client.name)}`, 302);
    }
    const csrf = randomBytes(18).toString("base64url");
    setCookie(c, CSRF_COOKIE, csrf, {
      httpOnly: true,
      secure: d.cookieSecure,
      sameSite: "Strict",
      path: "/oauth",
      maxAge: 900,
    });
    return page(c, consentPage(v.client.name, v.ok.redirect_uri, user, params, csrf), v.ok.redirect_uri);
  });

  app.post("/oauth/authorize", async (c) => {
    const form = Object.fromEntries(
      Object.entries(await c.req.parseBody()).map(([k, val]) => [k, String(val)]),
    );
    const { csrf, decision, ...params } = form;
    const v = validate(params);
    if (v.kind === "err") return page(c, errorPage(v.error), null, 400);
    const user = await sessionUser(c);
    const cookieCsrf = getCookie(c, CSRF_COOKIE);
    deleteCookie(c, CSRF_COOKIE, { path: "/oauth" });
    if (!user || !csrf || csrf !== cookieCsrf)
      return page(c, errorPage("La sesión ha caducado. Vuelve a intentarlo."), null, 400);
    if (decision !== "allow") {
      return c.redirect(back(v.ok.redirect_uri, { error: "access_denied", state: v.ok.state }), 302);
    }
    const code = randomBytes(32).toString("base64url");
    d.db
      .prepare(
        `INSERT INTO oauth_codes (hash, client_id, redirect_uri, challenge, owner_email, owner_name, owner_provider, owner_role, expires_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sha256(code),
        v.client.client_id,
        v.ok.redirect_uri,
        v.ok.code_challenge,
        user.email.toLowerCase(),
        user.name,
        user.provider,
        user.role,
        d.now() + CODE_TTL_MS,
      );
    log.info("oauth: autorizado", { client: v.client.name, email: user.email });
    return c.redirect(back(v.ok.redirect_uri, { code, state: v.ok.state, iss: base }), 302);
  });

  // ── Tokens ────────────────────────────────────────────────────────────────
  const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) => {
    c.header("Cache-Control", "no-store");
    return c.json({ error, error_description: description }, status);
  };

  async function readBody(c: Context): Promise<Record<string, string>> {
    const type = c.req.header("content-type") ?? "";
    if (type.includes("application/json")) {
      const j = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, val]) => [k, String(val)]));
    }
    const f = await c.req.parseBody().catch(() => ({}));
    return Object.fromEntries(Object.entries(f).map(([k, val]) => [k, String(val)]));
  }

  app.post("/oauth/token", async (c) => {
    const b = await readBody(c);
    const now = d.now();
    if (b.grant_type === "authorization_code") {
      const row = d.db.prepare("SELECT * FROM oauth_codes WHERE hash = ?").get(sha256(b.code ?? "")) as
        | {
            client_id: string;
            redirect_uri: string;
            challenge: string;
            owner_email: string;
            owner_name: string | null;
            owner_provider: "google" | "center";
            owner_role: string;
            expires_ms: number;
            used: number;
          }
        | undefined;
      if (!row || row.used || row.expires_ms < now)
        return oauthError(c, "invalid_grant", "Código inválido o caducado");
      d.db.prepare("UPDATE oauth_codes SET used = 1 WHERE hash = ?").run(sha256(b.code ?? ""));
      if (row.client_id !== b.client_id || row.redirect_uri !== b.redirect_uri) {
        return oauthError(c, "invalid_grant", "El código no es de este cliente");
      }
      const challenge = createHash("sha256")
        .update(b.code_verifier ?? "")
        .digest("base64url");
      if (challenge !== row.challenge) return oauthError(c, "invalid_grant", "PKCE no coincide");
      const cl = client(row.client_id);
      const t = d.tokens.createGrant(
        { email: row.owner_email, name: row.owner_name, provider: row.owner_provider, role: row.owner_role },
        row.client_id,
        cl?.name ?? "Aplicación MCP",
        now,
      );
      c.header("Cache-Control", "no-store");
      return c.json({
        access_token: t.access,
        token_type: "Bearer",
        expires_in: t.expiresIn,
        refresh_token: t.refresh,
        scope: SCOPE,
      });
    }
    if (b.grant_type === "refresh_token") {
      const t = d.tokens.refresh(b.refresh_token ?? "", b.client_id ?? "", now);
      if (!t) return oauthError(c, "invalid_grant", "Refresh token inválido, caducado o revocado");
      c.header("Cache-Control", "no-store");
      return c.json({
        access_token: t.access,
        token_type: "Bearer",
        expires_in: t.expiresIn,
        refresh_token: t.refresh,
        scope: SCOPE,
      });
    }
    return oauthError(c, "unsupported_grant_type", "Solo authorization_code y refresh_token");
  });

  app.post("/oauth/revoke", async (c) => {
    const b = await readBody(c);
    const h = sha256(b.token ?? "");
    const row = d.db.prepare("SELECT grant_id FROM oauth_tokens WHERE hash = ?").get(h) as
      | { grant_id: string }
      | undefined;
    if (row) d.tokens.revoke(row.grant_id, "el propio cliente", d.now());
    return c.body(null, 200);
  });

  /** Vuelve a la autorización que quedó pendiente al pedir el login (si la hay). */
  return {
    takeNext(c: Context): string | null {
      const next = getCookie(c, NEXT_COOKIE);
      if (!next) return null;
      deleteCookie(c, NEXT_COOKIE, { path: "/" });
      return next.startsWith("/oauth/authorize?") ? next : null;
    },
  };
}

// ── Páginas de consentimiento (HTML del servidor, sin JavaScript) ────────────

function page(c: Context, body: string, redirectUri: string | null, status: 200 | 400 = 200) {
  // El formulario redirige a la app que pidió acceso: hay que permitir ese destino en form-action.
  const target = redirectUri ? new URL(redirectUri) : null;
  const formTarget = target
    ? ["http:", "https:"].includes(target.protocol)
      ? target.origin
      : `${target.protocol}`
    : "";
  c.header(
    "Content-Security-Policy",
    `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self' ${formTarget}; frame-ancestors 'none'; base-uri 'none'`,
  );
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  return c.html(shell(body), status);
}

function shell(body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Conectar · Ringover 4Geeks</title><link rel="icon" href="/favicon.svg">
<style>
:root{--bg:#f6f6f3;--card:#fdfdfc;--ink:#0b0b0b;--ink2:#52514e;--ink3:#898781;--line:rgba(11,11,11,.1);--wash:#f2f1ee;--accent:#2a78d6}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d0d;--card:#171716;--ink:#f5f5f2;--ink2:#c3c2b7;--ink3:#8f8d86;--line:rgba(255,255,255,.1);--wash:#1f1f1d;--accent:#3987e5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:100%;max-width:440px;background:var(--card);border-radius:16px;box-shadow:0 0 0 1px var(--line),0 20px 50px -20px rgba(0,0,0,.25);padding:32px 28px}
.logo{display:flex;justify-content:center;margin-bottom:22px}.logo img{height:56px}
h1{font-size:20px;letter-spacing:-.02em;margin:0 0 8px;text-align:center}.sub{color:var(--ink2);text-align:center;margin:0 0 22px}
.who{display:flex;gap:12px;align-items:center;background:var(--wash);border-radius:12px;padding:12px 14px;margin-bottom:18px}
.av{width:36px;height:36px;border-radius:50%;background:var(--ink);color:var(--card);display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
.who b{display:block}.who span{color:var(--ink3);font-size:13px}
ul{margin:0 0 20px;padding:0;list-style:none}li{display:flex;gap:10px;padding:7px 0;color:var(--ink2);font-size:14px}li::before{content:"✓";color:var(--accent);font-weight:700}
.dest{font-size:12.5px;color:var(--ink3);margin:0 0 20px;word-break:break-all}
.row{display:grid;grid-template-columns:1fr 1.4fr;gap:10px}button{height:44px;border-radius:10px;border:0;font:600 15px system-ui,sans-serif;cursor:pointer}
.no{background:var(--wash);color:var(--ink)}.yes{background:linear-gradient(135deg,#2a78d6,#4a5bd8);color:#fff}button:focus-visible{outline:3px solid rgba(42,120,214,.45)}
.err{color:#b42318;text-align:center}
</style></head><body><main class="card">
<div class="logo"><picture><source srcset="/brand/ringover-4geeks-blanco.png" media="(prefers-color-scheme: dark)"><img src="/brand/ringover-4geeks-negro.png" alt="Ringover 4Geeks"></picture></div>
${body}</main></body></html>`;
}

function consentPage(
  clientName: string,
  redirectUri: string,
  user: SessionUser,
  params: Record<string, string>,
  csrf: string,
) {
  const hidden = Object.entries(params)
    .filter(([k]) =>
      [
        "response_type",
        "client_id",
        "redirect_uri",
        "code_challenge",
        "code_challenge_method",
        "state",
        "scope",
        "resource",
      ].includes(k),
    )
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const host = (() => {
    try {
      return new URL(redirectUri).host || redirectUri;
    } catch {
      return redirectUri;
    }
  })();
  return `<h1>${esc(clientName)} quiere conectarse</h1>
<p class="sub">Podrá consultar los datos de llamadas del equipo de España con tus permisos.</p>
<div class="who"><div class="av">${esc(initials)}</div><div><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div></div>
<ul><li>Métricas diarias, por comercial y por periodo</li><li>Listado de llamadas e historial de números</li><li>Solo lectura: no puede cambiar nada</li></ul>
<p class="dest">Volverá a: ${esc(host)} · Puedes revocar el acceso cuando quieras en Ringover › IA › Tokens.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="row"><button class="no" name="decision" value="deny">Cancelar</button><button class="yes" name="decision" value="allow" autofocus>Permitir acceso</button></div></form>`;
}

function errorPage(message: string) {
  return `<h1>No se puede conectar</h1><p class="sub err">${esc(message)}</p>`;
}
