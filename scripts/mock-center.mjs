// Imitación mínima del login de 4Geeks Center para desarrollo local y tests E2E.
// Cuentas: demo@4geeks.test / demo (admin) · sinacceso@4geeks.test / demo (sin permiso de llamadas)
// SSO: /sso actúa como si la sesión de Center fuera de demo@4geeks.test y vuelve con un código.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_CENTER_PORT ?? 8099);
const USERS = {
  "demo@4geeks.test": { id: "u-admin", name: "Nacho Demo", email: "demo@4geeks.test", role: "admin" },
  "sinacceso@4geeks.test": {
    id: "u-mkt",
    name: "Marketing Demo",
    email: "sinacceso@4geeks.test",
    role: "marketing",
  },
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (u) =>
  `${b64({ alg: "HS256" })}.${b64({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 7200 })}.firma`;
const byToken = (req) => {
  const t = /access_token=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  if (!t) return null;
  const sub = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).sub;
  return Object.values(USERS).find((u) => u.id === sub) ?? null;
};
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  // ── Google simulado (para el login con Google en local y en los E2E) ──
  if (req.method === "GET" && url.pathname === "/google/auth") {
    const p = url.searchParams;
    const email = p.get("como") ?? "nacho@4geeksacademy.com";
    const hd = email.endsWith("@4geeksacademy.com") ? "4geeksacademy.com" : undefined;
    const code = b64({
      email,
      hd,
      nonce: p.get("nonce"),
      cc: p.get("code_challenge"),
      aud: p.get("client_id"),
    });
    const back = new URL(p.get("redirect_uri"));
    back.search = new URLSearchParams({ code, state: p.get("state") }).toString();
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/google/token") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const f = new URLSearchParams(raw);
      const c = JSON.parse(Buffer.from(f.get("code") ?? "", "base64url").toString());
      if (
        createHash("sha256")
          .update(f.get("code_verifier") ?? "")
          .digest("base64url") !== c.cc
      ) {
        return send(res, 400, { error: "invalid_grant" });
      }
      const claims = {
        iss: "https://accounts.google.com",
        aud: f.get("client_id"),
        exp: Math.floor(Date.now() / 1000) + 3600,
        email: c.email,
        email_verified: true,
        hd: c.hd,
        nonce: c.nonce,
        name: c.email.split("@")[0].replace(/^./, (x) => x.toUpperCase()),
      };
      send(res, 200, { id_token: `${b64({ alg: "RS256" })}.${b64(claims)}.firma` });
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/sso/clients/ringover") {
    return send(res, 200, { name: "Llamadas · Ringover" });
  }
  if (req.method === "GET" && url.pathname === "/sso") {
    const p = url.searchParams;
    const who = p.get("como") ?? "demo@4geeks.test";
    const code = b64({ email: who, cc: p.get("code_challenge"), ruri: p.get("redirect_uri") });
    const back = new URL(p.get("redirect_uri"));
    back.search = new URLSearchParams({ code, state: p.get("state") }).toString();
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/api/auth/sso/token") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const b = JSON.parse(raw || "{}");
      const c = JSON.parse(Buffer.from(String(b.code), "base64url").toString());
      const ok =
        createHash("sha256").update(b.code_verifier).digest("base64url") === c.cc &&
        c.ruri === b.redirect_uri;
      const u = USERS[c.email];
      if (!ok || !u) return send(res, 400, { detail: "Código inválido" });
      send(res, 200, { user: u, access_token: token(u), expires_in: 7200 });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/auth/login") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const { email, password } = JSON.parse(raw || "{}");
      const u = USERS[email];
      if (!u || password !== "demo") return send(res, 401, { detail: "Credenciales inválidas" });
      send(res, 200, { user: u }, { "set-cookie": `access_token=${token(u)}; HttpOnly; Path=/` });
    });
    return;
  }
  const u = byToken(req);
  if (!u) return send(res, 401, { detail: "No autenticado" });
  if (req.url === "/api/auth/me") return send(res, 200, u);
  if (req.url === "/api/dashboards/tree") {
    const dashboards =
      u.role === "admin" ? [{ slug: "admisiones-contactabilidad" }] : [{ slug: "marketing" }];
    return send(res, 200, [{ name: "General", dashboards }]);
  }
  send(res, 404, { detail: "Not found" });
}).listen(PORT, "127.0.0.1", () => console.log(`Center simulado en http://127.0.0.1:${PORT}`));
