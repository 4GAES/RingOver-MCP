import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import type { SessionUser } from "../shared/api";
import { addDays, isDay, localDay } from "../shared/time";
import { type CenterAuth, CenterAuthError } from "./auth/center";
import { type GoogleAuth, GoogleAuthError } from "./auth/google";
import { COOKIE, GOOGLE_SESSION_MS, type Sessions } from "./auth/sessions";
import { type ApiTokens, CONFIG_TOKEN_ID } from "./auth/tokens";
import { normEmail, type Users } from "./auth/users";
import type { Config } from "./config";
import type { DB } from "./db";
import { type Leads, leadSchema } from "./leads";
import { errMsg, log } from "./log";
import type { McpLog } from "./mcp/log";
import { registerOAuth } from "./mcp/oauth";
import { createMcpServer, mcpCatalog } from "./mcp/server";
import {
  agentDetail,
  agentOptions,
  dataStatus,
  listCalls,
  liveTeam,
  numberHistory,
  overview,
  type StatusExtra,
} from "./queries/metrics";
import { PeriodError } from "./queries/period";

export interface AppDeps {
  db: DB;
  config: Pick<
    Config,
    | "COOKIE_SECURE"
    | "MCP_TOKEN"
    | "STATIC_DIR"
    | "NODE_ENV"
    | "CENTER_PUBLIC_URL"
    | "PUBLIC_URL"
    | "SSO_CLIENT_ID"
  >;
  sessions: Sessions;
  center: Pick<CenterAuth, "login" | "exchangeSso" | "ssoAvailable">;
  users: Users;
  tokens: ApiTokens;
  mcpLog: McpLog;
  leads?: Leads;
  google?: Pick<GoogleAuth, "enabled" | "authorizeUrl" | "exchange">;
  allowedDomain?: string;
  status: () => StatusExtra;
  syncNow?: () => Promise<unknown>;
  now?: () => number;
}

type Env = { Variables: { user: SessionUser } };

/** Selección de comerciales: "101,102,0" (0 = sin asignar). Vacío o ausente = todo el equipo. */
const agentList = z
  .string()
  .max(2000)
  .regex(/^(\d{1,12}(,\d{1,12})*)?$/, "Lista de comerciales inválida")
  .transform((v) => [...new Set(v.split(",").filter(Boolean).map(Number))].slice(0, 300))
  .optional();

const periodQuery = z.object({
  from: z.string().refine(isDay, "Fecha inválida").optional(),
  to: z.string().refine(isDay, "Fecha inválida").optional(),
  comerciales: agentList,
});

const callsQuery = periodQuery.extend({
  agent: z.coerce.number().int().min(0).optional(),
  tipo: z.enum(["nuevas", "antiguas"]).optional(),
  resultado: z.enum(["contestadas", "no_contestadas"]).optional(),
  duracion: z.enum(["mas15", "menos5", "entre5y15"]).optional(),
  numero: z.string().max(32).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const loginBody = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

/** Límite sencillo de intentos de login por IP (10 cada 15 min). */
function loginLimiter() {
  const hits = new Map<string, { n: number; reset: number }>();
  return (ip: string, now: number) => {
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + 15 * 60_000 });
      return true;
    }
    h.n++;
    return h.n <= 10;
  };
}

const clientIp = (c: Context) =>
  c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function createApp(deps: AppDeps) {
  const { db, config, sessions } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono<Env>();
  const allowLogin = loginLimiter();
  let lastManualSync = 0;

  app.onError((err, c) => {
    if (err instanceof PeriodError) return c.json({ error: err.message }, 400);
    if (err instanceof z.ZodError)
      return c.json({ error: err.issues[0]?.message ?? "Petición inválida" }, 400);
    log.error("error no controlado", { path: c.req.path, error: errMsg(err) });
    return c.json({ error: "Error interno" }, 500);
  });

  const secure = secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "https:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "same-origin",
    crossOriginEmbedderPolicy: false,
  });
  app.use("*", (c, next) => (c.req.path.startsWith("/oauth/authorize") ? next() : secure(c, next)));
  // CORS para clientes MCP que corren en el navegador (descubrimiento, registro, tokens y /mcp).
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (
      !(
        p === "/mcp" ||
        p.startsWith("/.well-known/") ||
        p === "/oauth/token" ||
        p === "/oauth/register" ||
        p === "/oauth/revoke"
      )
    ) {
      return next();
    }
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    );
    c.header("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
    c.header("Access-Control-Max-Age", "86400");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.get("/healthz", (c) => {
    const s = dataStatus(db, deps.status());
    const stale = !s.callsSyncedMs || now() - s.callsSyncedMs > 45 * 60_000;
    return c.json({ ok: true, callsSyncedMs: s.callsSyncedMs, stale });
  });

  // ── MCP (solo lectura, token Bearer) ───────────────────────────────────────
  const oauth = registerOAuth(app, {
    db,
    tokens: deps.tokens,
    sessions,
    publicUrl: config.PUBLIC_URL,
    cookieSecure: config.COOKIE_SECURE,
    now,
  });
  const resourceMetadata = `${config.PUBLIC_URL.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;

  app.all("/mcp", async (c) => {
    const t0 = performance.now();
    const ip = clientIp(c);
    const auth = c.req.header("authorization") ?? "";
    // El esquema "Bearer" no distingue mayúsculas (RFC 6750 / RFC 9110).
    const bearer = /^bearer\s+(.+)$/i.exec(auth.trim())?.[1]?.trim() ?? "";
    const r = deps.tokens.resolve(bearer, now());
    if (!r.ok) {
      if (bearer) {
        deps.mcpLog.record({
          tsMs: now(),
          tokenId: r.tokenId ?? null,
          ownerEmail: deps.tokens.ownerOf(r.tokenId),
          client: c.req.header("user-agent") ?? null,
          method: "auth",
          status: "denied",
          error: r.reason,
          ip,
        });
      }
      return c.json({ error: "invalid_token", error_description: r.reason }, 401, {
        "WWW-Authenticate": `Bearer realm="ringover", resource_metadata="${resourceMetadata}"${bearer ? ', error="invalid_token"' : ""}`,
      });
    }
    const id = r.identity;

    // Qué pide (para el registro y para saber desde qué app se conecta).
    let rpc: {
      method?: string;
      params?: { name?: string; clientInfo?: { name?: string; version?: string } };
    } | null = null;
    if (c.req.method === "POST") {
      const body = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      rpc = Array.isArray(body) ? (body[0] ?? null) : body;
    }
    const info = rpc?.method === "initialize" ? rpc.params?.clientInfo : undefined;
    const client = info?.name ? `${info.name}${info.version ? ` ${info.version}` : ""}` : null;
    deps.tokens.touch(id.tokenId, ip, client, now());

    if (rpc?.method === "tools/call") {
      const limited = deps.mcpLog.checkLimit(id.tokenId, now());
      if (limited) {
        deps.mcpLog.record({
          tsMs: now(),
          tokenId: id.tokenId,
          ownerEmail: id.owner.email,
          client: client ?? lastClient(id.tokenId),
          method: "tools/call",
          tool: rpc.params?.name ?? null,
          status: "rate_limited",
          error: limited,
          ip,
        });
        return c.json({ error: "rate_limited", error_description: limited }, 429, { "Retry-After": "60" });
      }
    }

    // Sin estado: un servidor y un transporte por petición (sencillo y sin fugas de memoria).
    const server = createMcpServer(db, deps.status, {
      onToolCall: (e) =>
        deps.mcpLog.record({
          tsMs: now(),
          tokenId: id.tokenId,
          ownerEmail: id.owner.email,
          client: client ?? lastClient(id.tokenId),
          method: "tools/call",
          tool: e.tool,
          args: e.args,
          status: e.ok ? "ok" : "error",
          error: e.error ?? null,
          durationMs: e.ms,
          bytes: e.bytes,
          ip,
        }),
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    void transport.close().catch(() => undefined);
    if (rpc?.method === "initialize") {
      deps.mcpLog.record({
        tsMs: now(),
        tokenId: id.tokenId,
        ownerEmail: id.owner.email,
        client,
        method: "initialize",
        status: "ok",
        durationMs: performance.now() - t0,
        ip,
      });
    }
    return res;
  });

  const lastClient = (tokenId: string): string | null => {
    if (tokenId === CONFIG_TOKEN_ID) return null;
    const row = db.prepare("SELECT last_client FROM api_tokens WHERE id = ?").get(tokenId) as
      | { last_client: string | null }
      | undefined;
    return row?.last_client ?? null;
  };

  // ── Autenticación (cuentas de 4Geeks Center) ───────────────────────────────
  const sameOrigin: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== c.req.header("host"))
      return c.json({ error: "Origen no permitido" }, 403);
    if (!(c.req.header("content-type") ?? "").includes("application/json")) {
      return c.json({ error: "Se esperaba JSON" }, 415);
    }
    await next();
  };

  app.post("/api/auth/login", sameOrigin, async (c) => {
    if (!allowLogin(clientIp(c), now())) {
      return c.json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    }
    const parsed = loginBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Escribe tu email y tu contraseña de Center" }, 400);
    try {
      const login = await deps.center.login(parsed.data.email, parsed.data.password);
      const s = sessions.create(login, now());
      setCookie(c, COOKIE, s.id, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: "Lax",
        path: "/",
        maxAge: s.maxAgeS,
      });
      log.info("login", { email: login.user.email });
      return c.json({
        user: { ...login.user, provider: "center", admin: login.user.role === "admin" },
        next: oauth.takeNext(c),
      });
    } catch (e) {
      if (e instanceof CenterAuthError) return c.json({ error: e.message }, e.status);
      throw e;
    }
  });

  app.post("/api/auth/logout", sameOrigin, (c) => {
    const id = getCookie(c, COOKIE);
    if (id) sessions.destroy(id);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const user = await sessions.get(getCookie(c, COOKIE), now());
    if (!user) return c.json({ error: "Sesión caducada" }, 401);
    c.set("user", user);
    await next();
  };

  const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/options", "/api/leads"]);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API.has(c.req.path)) return next();
    return requireUser(c, next);
  });

  // ── Inicio de sesión único con 4Geeks Center (código + PKCE) ───────────────
  const SSO_COOKIE = "rg_sso";
  const callbackUrl = () => `${config.PUBLIC_URL.replace(/\/$/, "")}/auth/center/callback`;

  /** El login muestra el botón de Center solo si Center ya lo soporta. */
  app.get("/api/auth/options", async (c) =>
    c.json({
      sso: await deps.center.ssoAvailable(config.SSO_CLIENT_ID),
      google: Boolean(deps.google?.enabled),
      domain: deps.allowedDomain ?? null,
      centerUrl: config.CENTER_PUBLIC_URL,
    }),
  );

  // ── Login con Google (código + PKCE + nonce) ──────────────────────────────
  const G_COOKIE = "rg_g";
  const googleCallback = () => `${config.PUBLIC_URL.replace(/\/$/, "")}/auth/google/callback`;

  app.get("/auth/google", (c) => {
    if (!deps.google?.enabled)
      return c.redirect(`/?sso_error=${encodeURIComponent("El login con Google no está configurado")}`, 302);
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    setCookie(c, G_COOKIE, `${state}.${nonce}.${verifier}`, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "Lax",
      path: "/auth/google",
      maxAge: 600,
    });
    return c.redirect(
      deps.google.authorizeUrl({ redirectUri: googleCallback(), state, challenge, nonce }),
      302,
    );
  });

  app.get("/auth/google/callback", async (c) => {
    const fail = (msg: string) => c.redirect(`/?sso_error=${encodeURIComponent(msg)}`, 302);
    const saved = getCookie(c, G_COOKIE) ?? "";
    deleteCookie(c, G_COOKIE, { path: "/auth/google" });
    if (c.req.query("error")) return fail("Has cancelado el acceso con Google");
    const [state, nonce, verifier] = saved.split(".");
    const code = c.req.query("code");
    if (!deps.google?.enabled || !state || !nonce || !verifier || !code || c.req.query("state") !== state) {
      return fail("El acceso con Google ha caducado. Vuelve a intentarlo.");
    }
    try {
      const who = await deps.google.exchange({ code, verifier, nonce, redirectUri: googleCallback() });
      const role = deps.users.access(who.email);
      if (!role) {
        log.warn("login google sin acceso", { email: who.email });
        return fail(`${who.email} todavía no tiene acceso. Pide a un admin que te añada.`);
      }
      deps.users.touchLogin(who.email, who.name, now());
      const name = who.name ?? who.email.split("@")[0] ?? who.email;
      const s = sessions.create(
        {
          user: { id: `google:${who.email}`, email: who.email, name, role },
          token: "",
          expiresMs: now() + GOOGLE_SESSION_MS,
        },
        now(),
        "google",
      );
      setCookie(c, COOKIE, s.id, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: "Lax",
        path: "/",
        maxAge: s.maxAgeS,
      });
      log.info("login google", { email: who.email, role });
      return c.redirect(oauth.takeNext(c) ?? "/", 302);
    } catch (e) {
      if (e instanceof GoogleAuthError) return fail(e.message);
      throw e;
    }
  });

  app.get("/auth/center", (c) => {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    setCookie(c, SSO_COOKIE, `${state}.${verifier}`, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "Lax",
      path: "/auth/center",
      maxAge: 600,
    });
    const url = new URL("/sso", config.CENTER_PUBLIC_URL);
    url.search = new URLSearchParams({
      client_id: config.SSO_CLIENT_ID,
      redirect_uri: callbackUrl(),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/auth/center/callback", async (c) => {
    const fail = (msg: string) => c.redirect(`/?sso_error=${encodeURIComponent(msg)}`, 302);
    const saved = getCookie(c, SSO_COOKIE) ?? "";
    deleteCookie(c, SSO_COOKIE, { path: "/auth/center" });
    const [state, verifier] = saved.split(".");
    const code = c.req.query("code");
    // El state comprueba que el login lo empezó este mismo navegador (evita que te cuelen una sesión ajena).
    if (!state || !verifier || !code || c.req.query("state") !== state) {
      return fail("El acceso con Center ha caducado. Vuelve a intentarlo.");
    }
    try {
      const login = await deps.center.exchangeSso({
        clientId: config.SSO_CLIENT_ID,
        redirectUri: callbackUrl(),
        code,
        verifier,
      });
      const s = sessions.create(login, now());
      setCookie(c, COOKIE, s.id, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: "Lax",
        path: "/",
        maxAge: s.maxAgeS,
      });
      log.info("login sso", { email: login.user.email });
      return c.redirect(oauth.takeNext(c) ?? "/", 302);
    } catch (e) {
      if (e instanceof CenterAuthError) return fail(e.message);
      throw e;
    }
  });

  app.get("/api/auth/me", (c) => c.json({ user: c.get("user") }));

  // ── Solicitudes de acceso (formulario público de la landing) ──────────────
  app.post("/api/leads", sameOrigin, async (c) => {
    if (!deps.leads) return c.json({ error: "Formulario no disponible" }, 503);
    const ip = clientIp(c);
    const parsed = leadSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      // Un bot que rellena el campo trampa recibe un "gracias" y no se guarda nada.
      if (parsed.error.issues.some((i) => i.path[0] === "web")) return c.json({ ok: true });
      return c.json({ error: parsed.error.issues[0]?.message ?? "Revisa el formulario" }, 400);
    }
    if (!deps.leads.allow(ip, now()))
      return c.json({ error: "Demasiadas solicitudes. Prueba en un rato." }, 429);
    const r = await deps.leads.create(
      parsed.data,
      { ip, userAgent: c.req.header("user-agent") ?? null },
      now(),
    );
    return c.json({ ok: true, id: r.id });
  });

  // ── Lista de usuarios que pueden entrar con Google (solo admins) ──────────
  const userBody = z.object({
    email: z.email().max(200),
    role: z.enum(["admin", "viewer"]).default("viewer"),
  });
  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    if (!c.get("user").admin) return c.json({ error: "Solo los admins gestionan usuarios" }, 403);
    await next();
  };
  const domainOk = (email: string) =>
    !deps.allowedDomain || normEmail(email).endsWith(`@${deps.allowedDomain.toLowerCase()}`);

  app.get("/api/admin/leads", requireAdmin, (c) =>
    c.json({ leads: deps.leads?.list() ?? [], notifyTo: deps.leads?.notifyTo ?? null }),
  );

  app.get("/api/users", requireAdmin, (c) =>
    c.json({ users: deps.users.list(), domain: deps.allowedDomain ?? null }),
  );

  app.post("/api/users", sameOrigin, requireAdmin, async (c) => {
    const parsed = userBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Escribe un email válido" }, 400);
    if (!domainOk(parsed.data.email)) {
      return c.json(
        { error: `Solo cuentas de @${deps.allowedDomain} (el login con Google no admite otras)` },
        400,
      );
    }
    deps.users.add(parsed.data.email, parsed.data.role, c.get("user").email, now());
    log.info("usuario añadido", {
      email: normEmail(parsed.data.email),
      role: parsed.data.role,
      by: c.get("user").email,
    });
    return c.json({ users: deps.users.list() });
  });

  app.patch("/api/users/:email", sameOrigin, requireAdmin, async (c) => {
    const email = decodeURIComponent(c.req.param("email"));
    const parsed = z
      .object({ role: z.enum(["admin", "viewer"]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Rol inválido" }, 400);
    if (deps.users.isFixedAdmin(email)) return c.json({ error: "Es admin fijo por configuración" }, 400);
    if (normEmail(email) === normEmail(c.get("user").email))
      return c.json({ error: "No puedes cambiar tu propio rol" }, 400);
    if (!deps.users.setRole(email, parsed.data.role)) return c.json({ error: "No existe" }, 404);
    return c.json({ users: deps.users.list() });
  });

  app.delete("/api/users/:email", sameOrigin, requireAdmin, (c) => {
    const email = decodeURIComponent(c.req.param("email"));
    if (deps.users.isFixedAdmin(email)) return c.json({ error: "Es admin fijo por configuración" }, 400);
    if (normEmail(email) === normEmail(c.get("user").email))
      return c.json({ error: "No puedes quitarte a ti mismo" }, 400);
    if (!deps.users.remove(email)) return c.json({ error: "No existe" }, 404);
    sessions.destroyGoogleFor(normEmail(email));
    deps.tokens.revokeAllFor(normEmail(email), c.get("user").email, now());
    log.info("usuario quitado", { email: normEmail(email), by: c.get("user").email });
    return c.json({ users: deps.users.list() });
  });

  // ── Datos ─────────────────────────────────────────────────────────────────
  const range = (q: { from?: string; to?: string }) => {
    const today = localDay(now());
    const from = q.from ?? q.to ?? today;
    return { from, to: q.to ?? (q.from ? from : today) };
  };

  app.get("/api/overview", (c) => {
    const q = periodQuery.parse(c.req.query());
    const r = range(q);
    return c.json(overview(db, r.from, r.to, deps.status(), now(), q.comerciales));
  });

  app.get("/api/agents", (c) => c.json({ agents: agentOptions(db, now()) }));

  app.get("/api/agents/:id", (c) => {
    const id = z.coerce.number().int().min(0).parse(c.req.param("id"));
    const q = periodQuery.parse(c.req.query());
    const r = range(q);
    const d = agentDetail(db, id, r.from, r.to, deps.status(), now());
    return d ? c.json(d) : c.json({ error: "Comercial no encontrado" }, 404);
  });

  app.get("/api/calls", (c) => {
    const q = callsQuery.parse(c.req.query());
    const r = range(q);
    return c.json(listCalls(db, { ...q, ...r, agents: q.comerciales }, now()));
  });

  app.get("/api/numbers/:number", (c) => {
    const h = numberHistory(db, c.req.param("number"));
    return h ? c.json(h) : c.json({ error: "Número inválido" }, 400);
  });

  app.get("/api/live", (c) => c.json(liveTeam(db, deps.status(), now())));

  app.post("/api/sync", sameOrigin, async (c) => {
    if (!deps.syncNow) return c.json({ ok: false, error: "Sincronización desactivada" }, 503);
    if (now() - lastManualSync < 60_000) return c.json({ ok: true, skipped: true });
    lastManualSync = now();
    await deps.syncNow();
    return c.json({ ok: true });
  });

  // ── MCP en el panel: conectar, tokens, actividad y consumo ────────────────
  const owner = (u: SessionUser) => ({ email: u.email, name: u.name, provider: u.provider, role: u.role });
  /** Los admins pueden ver todo el equipo con ?todo=1; el resto, solo lo suyo. */
  const scopeEmail = (c: Context<Env>) =>
    c.get("user").admin && c.req.query("todo") === "1" ? undefined : c.get("user").email;

  app.get("/api/mcp/info", (c) => {
    const cat = mcpCatalog(db);
    return c.json({ url: `${config.PUBLIC_URL.replace(/\/$/, "")}/mcp`, ...cat, limits: deps.mcpLog.limits });
  });

  app.get("/api/mcp/tokens", (c) => {
    const email = scopeEmail(c);
    return c.json({ tokens: deps.tokens.list({ ownerEmail: email, includeConfig: !email }, now()) });
  });

  app.post("/api/mcp/tokens", sameOrigin, async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        expiresDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()]),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Ponle un nombre y elige la caducidad" }, 400);
    const u = c.get("user");
    const t = deps.tokens.createPersonal(owner(u), parsed.data.name, parsed.data.expiresDays, now());
    log.info("token mcp creado", { email: u.email, name: parsed.data.name });
    return c.json({ token: t.token, id: t.id, tokens: deps.tokens.list({ ownerEmail: u.email }, now()) });
  });

  app.delete("/api/mcp/tokens/:id", sameOrigin, (c) => {
    const u = c.get("user");
    const tokenId = c.req.param("id");
    if (tokenId === CONFIG_TOKEN_ID)
      return c.json({ error: "El token de configuración se cambia en el servidor (.env)" }, 400);
    if (!deps.tokens.canManage(tokenId, u.email, u.admin)) return c.json({ error: "No es tuyo" }, 403);
    deps.tokens.revoke(tokenId, u.email, now());
    log.info("token mcp revocado", { id: tokenId, by: u.email });
    return c.json({ ok: true });
  });

  app.get("/api/mcp/log", (c) => {
    const q = z
      .object({
        tool: z.string().max(60).optional(),
        status: z.enum(["ok", "error", "denied", "rate_limited"]).optional(),
        token: z.string().max(60).optional(),
        persona: z.string().max(200).optional(),
        cursor: z
          .string()
          .regex(/^\d+:\d+$/)
          .optional(),
      })
      .parse(c.req.query());
    const own = scopeEmail(c);
    return c.json(
      deps.mcpLog.list({
        ownerEmail: own ?? q.persona,
        tool: q.tool,
        status: q.status,
        tokenId: q.token,
        cursor: q.cursor ?? null,
      }),
    );
  });

  app.get("/api/mcp/usage", (c) => {
    const q = periodQuery.parse(c.req.query());
    const to = q.to ?? localDay(now());
    const from = q.from ?? addDays(to, -29);
    return c.json(deps.mcpLog.usage(from, to, scopeEmail(c)));
  });

  app.all("/api/*", (c) => c.json({ error: "No existe" }, 404));

  // ── Panel (SPA) ───────────────────────────────────────────────────────────
  const root = config.STATIC_DIR;
  let landingHtml: string | null | undefined;
  const landing = () => {
    if (landingHtml === undefined || config.NODE_ENV !== "production") {
      try {
        landingHtml = readFileSync(join(root, "landing.html"), "utf8");
      } catch {
        landingHtml = null;
      }
    }
    return landingHtml;
  };
  let indexHtml: string | null = null;
  const index = () => {
    if (indexHtml === null || config.NODE_ENV !== "production") {
      try {
        indexHtml = readFileSync(join(root, "index.html"), "utf8");
      } catch {
        indexHtml = "<!doctype html><title>Ringover</title><p>Falta compilar el panel (npm run build).</p>";
      }
    }
    return indexHtml;
  };
  app.use(
    "/assets/*",
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.use("/favicon.svg", serveStatic({ root }));
  for (const f of ["/robots.txt", "/sitemap.xml", "/llms.txt", "/og.png"]) {
    app.use(
      f,
      serveStatic({
        root,
        onFound: (_p, c) => {
          c.header("Cache-Control", "public, max-age=3600");
        },
      }),
    );
  }
  app.use("/apple-touch-icon.png", serveStatic({ root }));
  app.use(
    "/brand/*",
    serveStatic({
      root,
      onFound: (_p, c) => {
        c.header("Cache-Control", "public, max-age=86400");
      },
    }),
  );
  // La portada: sin sesión, la landing ya renderizada (contenido real en el HTML para
  // Google y para los rastreadores de IA, que no ejecutan JavaScript); con sesión, el panel.
  app.get("/", async (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("Vary", "Cookie");
    const user = getCookie(c, COOKIE) ? await sessions.get(getCookie(c, COOKIE), now()) : null;
    const html = !user ? landing() : null;
    return c.html(html ?? index());
  });
  // Aviso legal, privacidad y cookies: públicas e indexables, ya renderizadas.
  const legalHtml = new Map<string, string | null>();
  for (const slug of ["aviso-legal", "privacidad", "cookies"]) {
    app.get(`/${slug}`, (c) => {
      if (!legalHtml.has(slug) || config.NODE_ENV !== "production") {
        try {
          legalHtml.set(slug, readFileSync(join(root, `legal-${slug}.html`), "utf8"));
        } catch {
          legalHtml.set(slug, null);
        }
      }
      c.header("Cache-Control", "no-cache");
      return c.html(legalHtml.get(slug) ?? index());
    });
  }
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache");
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(index());
  });

  return app;
}
