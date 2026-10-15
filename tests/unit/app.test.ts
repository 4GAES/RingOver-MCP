import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { CenterAuth } from "../../src/server/auth/center";
import { GoogleAuth } from "../../src/server/auth/google";
import { Sessions } from "../../src/server/auth/sessions";
import { ApiTokens } from "../../src/server/auth/tokens";
import { Users } from "../../src/server/auth/users";
import { McpLog } from "../../src/server/mcp/log";
import { recomputeNewness, saveCalls } from "../../src/server/sync/calls";
import { localDay } from "../../src/shared/time";
import { call, memDb } from "./helpers";

const TOKEN = "t".repeat(40);
const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ sub: "u1", exp })).toString("base64url")}.y`;

/** Center falso: admin@ entra con todo, mkt@ entra pero sin permiso de llamadas. */
const centerFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const cookie = new Headers(init?.headers).get("cookie") ?? "";
  if (url.endsWith("/api/auth/login")) {
    const { email, password } = JSON.parse(String(init?.body));
    if (password !== "ok") return new Response("{}", { status: 401 });
    const role = email.startsWith("admin") ? "admin" : "marketing";
    return new Response(JSON.stringify({ ok: 1 }), {
      headers: {
        "set-cookie": `access_token=${jwt(Math.floor(Date.now() / 1000) + 3600)}.${role}; HttpOnly`,
      },
    });
  }
  const role = cookie.includes(".admin") ? "admin" : "marketing";
  if (url.endsWith("/api/auth/me")) {
    return Response.json({ id: "u1", name: "Usuaria", email: `${role}@x.test`, role });
  }
  if (url.endsWith("/api/dashboards/tree")) return Response.json([{ dashboards: [{ slug: "marketing" }] }]);
  if (url.endsWith("/api/auth/sso/clients/ringover")) return Response.json({ name: "Llamadas" });
  if (url.endsWith("/api/auth/sso/token")) {
    const b = JSON.parse(String(init?.body));
    // El Center falso guarda el challenge en el propio código para poder comprobar el PKCE.
    const [role, challenge] = String(b.code).split(":");
    const ok = createHash("sha256").update(b.code_verifier).digest("base64url") === challenge;
    if (!ok || b.redirect_uri !== "https://ringover.test/auth/center/callback")
      return new Response("{}", { status: 400 });
    return Response.json({
      user: { id: "u2", name: "Por SSO", email: `${role}@x.test`, role },
      access_token: `${jwt(Math.floor(Date.now() / 1000) + 3600)}.${role}`,
    });
  }
  return new Response("", { status: 404 });
};

const limits = { perMin: 60, perDay: 2000 };

function setup(lim = limits) {
  const db = memDb();
  saveCalls(db, [call({ start: new Date(Date.now() - 3600_000).toISOString(), talk: 1000 })]);
  recomputeNewness(db);
  const center = new CenterAuth({
    baseUrl: "http://center.test",
    callsSlug: "admisiones-contactabilidad",
    fetchImpl: centerFetch,
  });
  const users = new Users(db, "jefa@4geeksacademy.com");
  const google = new GoogleAuth({
    clientId: "cliente-test",
    clientSecret: "secreto",
    allowedDomain: "4geeksacademy.com",
    authUrl: "https://google.test/auth",
    tokenUrl: "https://google.test/token",
    fetchImpl: googleFetch,
  });
  const app = createApp({
    db,
    config: {
      COOKIE_SECURE: false,
      MCP_TOKEN: TOKEN,
      STATIC_DIR: "./no-existe",
      NODE_ENV: "test",
      CENTER_PUBLIC_URL: "https://center.test",
      PUBLIC_URL: "https://ringover.test",
      SSO_CLIENT_ID: "ringover",
    },
    sessions: new Sessions(db, center, users),
    center,
    users,
    tokens: new ApiTokens(db, users, TOKEN),
    mcpLog: new McpLog(db, { perMin: lim.perMin, perDay: lim.perDay }),
    google,
    allowedDomain: "4geeksacademy.com",
    status: () => ({}),
  });
  return Object.assign(app, { db });
}

/** Google falso: el "código" lleva dentro el email, el dominio y el nonce que Google firmaría. */
const googleFetch: typeof fetch = async (input, init) => {
  if (!String(input).endsWith("/token")) return new Response("", { status: 404 });
  const form = new URLSearchParams(String(init?.body));
  const c = JSON.parse(Buffer.from(form.get("code") ?? "", "base64url").toString());
  if (
    createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url") !== c.cc
  ) {
    return new Response("{}", { status: 400 });
  }
  const claims = {
    iss: "https://accounts.google.com",
    aud: "cliente-test",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: c.email,
    email_verified: true,
    hd: c.hd,
    nonce: c.nonce,
    name: "Nombre Google",
  };
  return Response.json({ id_token: `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s` });
};

const login = (app: ReturnType<typeof setup>, email: string, password = "ok") =>
  app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

describe("acceso con cuentas de Center", () => {
  it("sin sesión, los datos están cerrados", async () => {
    expect((await setup().request("/api/overview")).status).toBe(401);
  });

  it("un admin de Center entra y ve los datos", async () => {
    const app = setup();
    const res = await login(app, "admin@x.test");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toMatch(/^rg_sid=/);
    const data = await app.request("/api/overview", { headers: { cookie } });
    expect(data.status).toBe(200);
    expect((await data.json()).totals.mas15).toBe(1);
  });

  it("contraseña mala → 401; usuario sin permiso de llamadas → 403", async () => {
    const app = setup();
    expect((await login(app, "admin@x.test", "mal")).status).toBe(401);
    const res = await login(app, "mkt@x.test");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/no tiene acceso/);
  });

  it("rechaza logins desde otro origen", async () => {
    const res = await setup().request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://malo.test", host: "ringover.test" },
      body: JSON.stringify({ email: "admin@x.test", password: "ok" }),
    });
    expect(res.status).toBe(403);
  });

  it("filtra el resumen y las llamadas por una selección de comerciales", async () => {
    const app = setup();
    const cookie = (await login(app, "admin@x.test")).headers.get("set-cookie")?.split(";")[0] ?? "";
    const day = localDay(Date.now() - 3600_000);
    const get = async (q: string) =>
      (await app.request(`/api/overview?from=${day}&${q}`, { headers: { cookie } })).json();
    expect((await get("comerciales=1")).totals.llamadas).toBe(1);
    expect((await get("comerciales=2")).totals.llamadas).toBe(0);
    expect((await get("comerciales=")).totals.llamadas).toBe(1);
    const calls = await app.request(`/api/calls?from=${day}&comerciales=2,3`, { headers: { cookie } });
    expect((await calls.json()).total).toBe(0);
    const bad = await app.request("/api/overview?comerciales=1;DROP", { headers: { cookie } });
    expect(bad.status).toBe(400);
    const agents = await (await app.request("/api/agents", { headers: { cookie } })).json();
    expect(agents.agents[0]).toMatchObject({ id: 1, active: true });
  });

  it("valida los parámetros", async () => {
    const app = setup();
    const cookie = (await login(app, "admin@x.test")).headers.get("set-cookie")?.split(";")[0] ?? "";
    const res = await app.request("/api/overview?from=ayer", { headers: { cookie } });
    expect(res.status).toBe(400);
  });
});

describe("MCP", () => {
  const rpc = (app: ReturnType<typeof setup>, body: unknown, token = TOKEN) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  it("acepta el esquema bearer sin importar mayúsculas", async () => {
    const res = await setup().request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `bearer ${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
  });

  it("una fecha imposible da un error claro, no datos de otro día", async () => {
    const app = setup();
    const res = await rpc(app, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "resumen", arguments: { desde: "2026-02-30" } },
    });
    const body = await res.json();
    const text = body.error?.message ?? body.result?.content?.[0]?.text ?? "";
    expect(text).toMatch(/inexistente/);
  });

  it("exige el token", async () => {
    expect((await rpc(setup(), { jsonrpc: "2.0", id: 1, method: "tools/list" }, "malo")).status).toBe(401);
  });

  it("lista las herramientas y responde un resumen", async () => {
    const app = setup();
    const init = await rpc(app, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.status).toBe(200);
    const list = await (await rpc(app, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "resumen",
        "evolucion",
        "comparar",
        "ranking",
        "llamadas",
        "jornada",
        "estado_ahora",
      ]),
    );
    const res = await (
      await rpc(app, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "resumen", arguments: {} },
      })
    ).json();
    const data = JSON.parse(res.result.content[0].text);
    expect(data.equipo.llamadas_mas_15_min).toBe(1);
    expect(data.equipo.tiempo_en_llamada).toBe("16 min");
  });

  it("explica el error si el comercial no existe", async () => {
    const res = await (
      await rpc(setup(), {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "resumen", arguments: { comercial: "nadie" } },
      })
    ).json();
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/No encuentro/);
  });
});

describe("inicio de sesión único con Center", () => {
  const cookieOf = (res: Response, name: string) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith(`${name}=`)) ?? "";

  async function start(app: ReturnType<typeof setup>) {
    const res = await app.request("/auth/center");
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location") ?? "");
    return { to, cookie: cookieOf(res, "rg_sso") };
  }

  it("anuncia que el botón de Center está disponible", async () => {
    const res = await setup().request("/api/auth/options");
    expect(await res.json()).toMatchObject({ sso: true, centerUrl: "https://center.test" });
  });

  it("manda a Center con PKCE y state, y vuelve con sesión", async () => {
    const app = setup();
    const { to, cookie } = await start(app);
    expect(to.origin + to.pathname).toBe("https://center.test/sso");
    expect(to.searchParams.get("redirect_uri")).toBe("https://ringover.test/auth/center/callback");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    const state = to.searchParams.get("state");
    const code = `admin:${to.searchParams.get("code_challenge")}`;
    const back = await app.request(`/auth/center/callback?code=${encodeURIComponent(code)}&state=${state}`, {
      headers: { cookie },
    });
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("/");
    const sid = cookieOf(back, "rg_sid");
    expect(sid).toMatch(/^rg_sid=.+/);
    const me = await (await app.request("/api/auth/me", { headers: { cookie: sid } })).json();
    expect(me.user.email).toBe("admin@x.test");
  });

  it("rechaza la vuelta si el state no es el de este navegador", async () => {
    const app = setup();
    const { to, cookie } = await start(app);
    const code = `admin:${to.searchParams.get("code_challenge")}`;
    const back = await app.request(`/auth/center/callback?code=${code}&state=otro`, { headers: { cookie } });
    expect(back.headers.get("location")).toMatch(/^\/\?sso_error=/);
    expect(cookieOf(back, "rg_sid")).toBe("");
  });

  it("aplica el permiso de llamadas también por SSO", async () => {
    const app = setup();
    const { to, cookie } = await start(app);
    const code = `marketing:${to.searchParams.get("code_challenge")}`;
    const back = await app.request(
      `/auth/center/callback?code=${code}&state=${to.searchParams.get("state")}`,
      {
        headers: { cookie },
      },
    );
    expect(decodeURIComponent(back.headers.get("location") ?? "")).toContain("no tiene acceso");
  });
});

describe("login con Google y lista de usuarios", () => {
  const cookieOf = (res: Response, name: string) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith(`${name}=`)) ?? "";

  /** Recorre el flujo completo como si Google devolviera esa cuenta. */
  async function googleLogin(
    app: ReturnType<typeof setup>,
    email: string,
    hd: string | undefined = "4geeksacademy.com",
  ) {
    const start = await app.request("/auth/google");
    const to = new URL(start.headers.get("location") ?? "");
    const code = Buffer.from(
      JSON.stringify({
        email,
        hd,
        nonce: to.searchParams.get("nonce"),
        cc: to.searchParams.get("code_challenge"),
      }),
    ).toString("base64url");
    const back = await app.request(
      `/auth/google/callback?code=${code}&state=${to.searchParams.get("state")}`,
      {
        headers: { cookie: cookieOf(start, "rg_g") },
      },
    );
    return { start, to, back, sid: cookieOf(back, "rg_sid") };
  }
  const api = (app: ReturnType<typeof setup>, sid: string, path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: { cookie: sid, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("manda a Google con PKCE, nonce y el dominio de la empresa", async () => {
    const { to } = await googleLogin(setup(), "jefa@4geeksacademy.com");
    expect(to.origin + to.pathname).toBe("https://google.test/auth");
    expect(to.searchParams.get("hd")).toBe("4geeksacademy.com");
    expect(to.searchParams.get("code_challenge_method")).toBe("S256");
    expect(to.searchParams.get("redirect_uri")).toBe("https://ringover.test/auth/google/callback");
    expect((await (await setup().request("/api/auth/options")).json()).google).toBe(true);
  });

  it("el admin fijo entra y gestiona la lista", async () => {
    const app = setup();
    const { back, sid } = await googleLogin(app, "jefa@4geeksacademy.com");
    expect(back.headers.get("location")).toBe("/");
    const me = await (await api(app, sid, "/api/auth/me")).json();
    expect(me.user).toMatchObject({ email: "jefa@4geeksacademy.com", admin: true, provider: "google" });
    const list = await (await api(app, sid, "/api/users")).json();
    expect(list.users[0]).toMatchObject({
      email: "jefa@4geeksacademy.com",
      fixed: true,
      name: "Nombre Google",
    });
  });

  it("una cuenta de la empresa que no está en la lista no entra", async () => {
    const { back, sid } = await googleLogin(setup(), "otra@4geeksacademy.com");
    expect(decodeURIComponent(back.headers.get("location") ?? "")).toContain("todavía no tiene acceso");
    expect(sid).toBe("");
  });

  it("rechaza cuentas personales aunque estén en la lista", async () => {
    const { back } = await googleLogin(setup(), "alguien@gmail.com", undefined);
    expect(decodeURIComponent(back.headers.get("location") ?? "")).toContain("@4geeksacademy.com");
  });

  it("el admin añade un lector: entra, ve datos y no puede gestionar; al quitarlo pierde la sesión", async () => {
    const app = setup();
    const admin = (await googleLogin(app, "jefa@4geeksacademy.com")).sid;
    expect((await api(app, admin, "/api/users", "POST", { email: "Ana@4geeksacademy.com" })).status).toBe(
      200,
    );
    expect((await api(app, admin, "/api/users", "POST", { email: "x@gmail.com" })).status).toBe(400);

    const ana = (await googleLogin(app, "ana@4geeksacademy.com")).sid;
    expect((await api(app, ana, "/api/overview")).status).toBe(200);
    expect((await api(app, ana, "/api/users")).status).toBe(403);

    expect((await api(app, admin, "/api/users/ana%404geeksacademy.com", "DELETE")).status).toBe(200);
    expect((await api(app, ana, "/api/overview")).status).toBe(401);
  });

  it("no se puede quitar al admin fijo ni a uno mismo; un admin de Center también gestiona", async () => {
    const app = setup();
    const admin = (await googleLogin(app, "jefa@4geeksacademy.com")).sid;
    expect((await api(app, admin, "/api/users/jefa%404geeksacademy.com", "DELETE")).status).toBe(400);
    const center = (await login(app, "admin@x.test")).headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await api(app, center, "/api/users")).status).toBe(200);
  });
});

describe("plataforma MCP: tokens, registro, consumo y OAuth", () => {
  const cookieOf = (res: Response, name: string) =>
    (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith(`${name}=`)) ?? "";

  async function google(app: ReturnType<typeof setup>, email: string) {
    const start = await app.request("/auth/google");
    const to = new URL(start.headers.get("location") ?? "");
    const code = Buffer.from(
      JSON.stringify({
        email,
        hd: "4geeksacademy.com",
        nonce: to.searchParams.get("nonce"),
        cc: to.searchParams.get("code_challenge"),
      }),
    ).toString("base64url");
    const back = await app.request(
      `/auth/google/callback?code=${code}&state=${to.searchParams.get("state")}`,
      {
        headers: { cookie: [cookieOf(start, "rg_g"), ...extraCookies].filter(Boolean).join("; ") },
      },
    );
    return { sid: cookieOf(back, "rg_sid"), back };
  }
  let extraCookies: string[] = [];
  const api = (app: ReturnType<typeof setup>, sid: string, path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: { cookie: sid, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const rpc = (app: ReturnType<typeof setup>, token: string, body: unknown) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  const init = (app: ReturnType<typeof setup>, token: string) =>
    rpc(app, token, {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Claude", version: "9.9" },
      },
    });
  const call = (
    app: ReturnType<typeof setup>,
    token: string,
    name: string,
    args: Record<string, unknown> = {},
  ) => rpc(app, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

  it("cada persona genera su token, lo usa, y queda registrado con su consumo", async () => {
    const app = setup();
    const { sid } = await google(app, "jefa@4geeksacademy.com");
    const created = await (
      await api(app, sid, "/api/mcp/tokens", "POST", { name: "Claude portátil", expiresDays: 90 })
    ).json();
    expect(created.token).toMatch(/^rgo_p_/);
    expect(created.tokens[0]).toMatchObject({
      name: "Claude portátil",
      status: "activo",
      prefix: created.token.slice(0, 12),
    });

    expect((await init(app, created.token)).status).toBe(200);
    const res = await (await call(app, created.token, "resumen")).json();
    expect(JSON.parse(res.result.content[0].text).equipo.llamadas_mas_15_min).toBe(1);

    const logRes = await (await api(app, sid, "/api/mcp/log")).json();
    expect(logRes.items[0]).toMatchObject({
      tool: "resumen",
      status: "ok",
      ownerEmail: "jefa@4geeksacademy.com",
      client: "Claude 9.9",
    });
    expect(logRes.items[0].bytes).toBeGreaterThan(100);

    const usage = await (await api(app, sid, "/api/mcp/usage")).json();
    expect(usage.totals).toMatchObject({ calls: 1, errors: 0, people: 1 });
    expect(usage.byTool[0].tool).toBe("resumen");
    const list = await (await api(app, sid, "/api/mcp/tokens")).json();
    expect(list.tokens[0]).toMatchObject({ calls30d: 1, lastClient: "Claude 9.9" });
  });

  it("un token revocado deja de valer y el intento queda registrado; el 401 indica dónde autorizar", async () => {
    const app = setup();
    const { sid } = await google(app, "jefa@4geeksacademy.com");
    const { token, id } = await (
      await api(app, sid, "/api/mcp/tokens", "POST", { name: "x", expiresDays: null })
    ).json();
    expect((await api(app, sid, `/api/mcp/tokens/${id}`, "DELETE")).status).toBe(200);
    const res = await call(app, token, "resumen");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://ringover.test/.well-known/oauth-protected-resource"',
    );
    const logRes = await (await api(app, sid, "/api/mcp/log?status=denied")).json();
    expect(logRes.items[0].error).toBe("Token revocado");
  });

  it("si a la persona le quitan el acceso, su token muere con ella", async () => {
    const app = setup();
    const admin = (await google(app, "jefa@4geeksacademy.com")).sid;
    await api(app, admin, "/api/users", "POST", { email: "ana@4geeksacademy.com" });
    const ana = (await google(app, "ana@4geeksacademy.com")).sid;
    const { token } = await (
      await api(app, ana, "/api/mcp/tokens", "POST", { name: "Ana", expiresDays: 30 })
    ).json();
    expect((await call(app, token, "comerciales")).status).toBe(200);
    await api(app, admin, "/api/users/ana%404geeksacademy.com", "DELETE");
    expect((await call(app, token, "comerciales")).status).toBe(401);
  });

  it("cada uno ve solo lo suyo; un admin puede ver todo el equipo", async () => {
    const app = setup();
    const admin = (await google(app, "jefa@4geeksacademy.com")).sid;
    await api(app, admin, "/api/users", "POST", { email: "ana@4geeksacademy.com" });
    const ana = (await google(app, "ana@4geeksacademy.com")).sid;
    await api(app, ana, "/api/mcp/tokens", "POST", { name: "De Ana", expiresDays: 30 });
    await api(app, admin, "/api/mcp/tokens", "POST", { name: "De la jefa", expiresDays: 30 });
    const own = await (await api(app, ana, "/api/mcp/tokens?todo=1")).json();
    expect(own.tokens.map((t: { name: string }) => t.name)).toEqual(["De Ana"]);
    const all = await (await api(app, admin, "/api/mcp/tokens?todo=1")).json();
    expect(all.tokens.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining(["De Ana", "De la jefa", "Token de configuración (heredado)"]),
    );
    const anaTok = own.tokens[0].id;
    expect((await api(app, admin, `/api/mcp/tokens/${anaTok}`, "DELETE")).status).toBe(200);
  });

  it("aplica el límite por minuto y lo registra", async () => {
    const app = setup({ perMin: 2, perDay: 100 });
    const { sid } = await google(app, "jefa@4geeksacademy.com");
    const { token } = await (
      await api(app, sid, "/api/mcp/tokens", "POST", { name: "x", expiresDays: 30 })
    ).json();
    expect((await call(app, token, "comerciales")).status).toBe(200);
    expect((await call(app, token, "comerciales")).status).toBe(200);
    const third = await call(app, token, "comerciales");
    expect(third.status).toBe(429);
    const logRes = await (await api(app, sid, "/api/mcp/log?status=rate_limited")).json();
    expect(logRes.items).toHaveLength(1);
  });

  it("publica herramientas nuevas, recursos y prompts", async () => {
    const app = setup();
    const tools = await (await rpc(app, TOKEN, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
    expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(
      expect.arrayContaining([
        "alertas",
        "seguimientos_pendientes",
        "mejores_horas",
        "comparar_comerciales",
        "informe",
      ]),
    );
    const prompts = await (await rpc(app, TOKEN, { jsonrpc: "2.0", id: 2, method: "prompts/list" })).json();
    expect(prompts.result.prompts).toHaveLength(5);
    const res = await (
      await rpc(app, TOKEN, {
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: { uri: "ringover://definiciones" },
      })
    ).json();
    expect(res.result.contents[0].text).toContain("Llamadas nuevas");
    const informe = await (await call(app, TOKEN, "informe", { tipo: "diario" })).json();
    expect(informe.result.content[0].text).toMatch(/^# Llamadas España · informe diario/);
  });

  it("OAuth completo: descubrimiento, registro, login, consentimiento, tokens, refresco y robo detectado", async () => {
    const app = setup();
    const prm = await (await app.request("/.well-known/oauth-protected-resource")).json();
    expect(prm).toMatchObject({
      resource: "https://ringover.test/mcp",
      authorization_servers: ["https://ringover.test"],
    });
    const meta = await (await app.request("/.well-known/oauth-authorization-server")).json();
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);

    const reg = await (
      await app.request("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      })
    ).json();
    const bad = await app.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://evil.test/cb"] }),
    });
    expect(bad.status).toBe(400);

    const verifier = "v".repeat(50);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const q = new URLSearchParams({
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource: "https://ringover.test/mcp",
    });
    // Sin sesión: manda al login y recuerda adónde volver.
    const noSession = await app.request(`/oauth/authorize?${q}`);
    expect(noSession.headers.get("location")).toMatch(/^\/\?conectar=Claude/);
    extraCookies = [cookieOf(noSession, "rg_next")];
    const { sid, back } = await google(app, "jefa@4geeksacademy.com");
    extraCookies = [];
    expect(back.headers.get("location")).toBe(`/oauth/authorize?${q}`);

    const consent = await app.request(`/oauth/authorize?${q}`, { headers: { cookie: sid } });
    const html = await consent.text();
    expect(html).toContain("Claude quiere conectarse");
    expect(consent.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const form = new URLSearchParams({ ...Object.fromEntries(q), csrf, decision: "allow" });
    const decided = await app.request("/oauth/authorize", {
      method: "POST",
      headers: {
        cookie: `${sid}; ${cookieOf(consent, "rg_csrf")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const redirect = new URL(decided.headers.get("location") ?? "");
    expect(redirect.origin + redirect.pathname).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(redirect.searchParams.get("state")).toBe("xyz");
    const code = redirect.searchParams.get("code") ?? "";

    const token = (b: Record<string, string>) =>
      app.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(b).toString(),
      });
    const wrong = await token({
      grant_type: "authorization_code",
      code,
      client_id: reg.client_id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: "x".repeat(50),
    });
    expect((await wrong.json()).error).toBe("invalid_grant");

    // El código ya se gastó con el intento fallido: se pide otro (un código, un solo uso).
    const consent2 = await app.request(`/oauth/authorize?${q}`, { headers: { cookie: sid } });
    const csrf2 = /name="csrf" value="([^"]+)"/.exec(await consent2.text())?.[1] ?? "";
    const decided2 = await app.request("/oauth/authorize", {
      method: "POST",
      headers: {
        cookie: `${sid}; ${cookieOf(consent2, "rg_csrf")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ ...Object.fromEntries(q), csrf: csrf2, decision: "allow" }).toString(),
    });
    const code2 = new URL(decided2.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const t1 = await (
      await token({
        grant_type: "authorization_code",
        code: code2,
        client_id: reg.client_id,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_verifier: verifier,
      })
    ).json();
    expect(t1).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect((await call(app, t1.access_token, "comerciales")).status).toBe(200);

    const conns = await (await api(app, sid, "/api/mcp/tokens")).json();
    expect(conns.tokens[0]).toMatchObject({ kind: "oauth", name: "Claude", status: "activo" });

    const t2 = await (
      await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: reg.client_id })
    ).json();
    expect(t2.access_token).toBeTruthy();
    // Reutilizar el refresh viejo = posible robo → se revoca toda la conexión.
    const reuse = await token({
      grant_type: "refresh_token",
      refresh_token: t1.refresh_token,
      client_id: reg.client_id,
    });
    expect((await reuse.json()).error).toBe("invalid_grant");
    expect((await call(app, t2.access_token, "comerciales")).status).toBe(401);
  });
});
