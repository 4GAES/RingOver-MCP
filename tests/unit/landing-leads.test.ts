import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { CenterAuth } from "../../src/server/auth/center";
import { Sessions } from "../../src/server/auth/sessions";
import { ApiTokens } from "../../src/server/auth/tokens";
import { Users } from "../../src/server/auth/users";
import { LeadMailer, Leads, leadSchema } from "../../src/server/leads";
import { McpLog } from "../../src/server/mcp/log";
import { LEGAL_VERSION } from "../../src/shared/legal";
import { memDb } from "./helpers";

function setup(brevo: typeof fetch | null = null) {
  const db = memDb();
  const dir = mkdtempSync(join(tmpdir(), "rg-web-"));
  writeFileSync(
    join(dir, "index.html"),
    '<html><head><meta name="robots" content="noindex, nofollow" /></head><body><div id="root"></div></body></html>',
  );
  writeFileSync(
    join(dir, "landing.html"),
    '<html><body><div id="root" data-landing="1"><h1>Analítica de llamadas e IA para Ringover</h1></div></body></html>',
  );
  writeFileSync(
    join(dir, "legal-privacidad.html"),
    '<html><body><div id="root" data-legal="privacidad"><h1>Política de privacidad</h1></div></body></html>',
  );
  const users = new Users(db, "jefa@equipo.test");
  const center = new CenterAuth({
    baseUrl: "http://center.test",
    callsSlug: "x",
    fetchImpl: async () => new Response("", { status: 401 }),
  });
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch =
    brevo ??
    (async (url, init) => {
      sent.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json({ messageId: "x" }, { status: 201 });
    });
  const leads = new Leads(
    db,
    new LeadMailer({
      apiKey: "clave",
      to: "ventas@equipo.test",
      from: "avisos@equipo.test",
      fromName: "Ringover 4Geeks",
      fetchImpl,
    }),
  );
  const app = createApp({
    db,
    config: {
      COOKIE_SECURE: false,
      MCP_TOKEN: "",
      STATIC_DIR: dir,
      NODE_ENV: "test",
      CENTER_PUBLIC_URL: "https://center.test",
      PUBLIC_URL: "https://ringover.test",
      SSO_CLIENT_ID: "ringover",
    },
    sessions: new Sessions(db, center, users),
    center,
    users,
    tokens: new ApiTokens(db, users, ""),
    mcpLog: new McpLog(db, { perMin: 60, perDay: 100 }),
    leads,
    status: () => ({}),
  });
  return { app, db, sent, leads };
}

const lead = {
  nombre: "Ana Pérez",
  email: "ana@empresa.test",
  empresa: "Empresa Test",
  comerciales: "6-20",
  telefono: "",
  mensaje: "Queremos ver las llamadas de 12 comerciales",
  consentimiento: true,
  web: "",
};
const post = (app: ReturnType<typeof setup>["app"], body: unknown, ip = "1.1.1.1") =>
  app.request("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });

describe("formulario de la landing", () => {
  it("guarda la solicitud y la envía por Brevo al equipo comercial, con respuesta directa al interesado", async () => {
    const { app, db, sent } = setup();
    const res = await post(app, lead);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(sent[0]?.headers.get("api-key")).toBe("clave");
    expect(sent[0]?.body).toMatchObject({
      to: [{ email: "ventas@equipo.test" }],
      sender: { email: "avisos@equipo.test" },
      replyTo: { email: "ana@empresa.test" },
      subject: "Nueva solicitud · Ringover 4Geeks · Empresa Test",
    });
    expect(String(sent[0]?.body.htmlContent)).toContain("12 comerciales");
    expect(db.prepare("SELECT empresa, email_sent FROM leads").get()).toEqual({
      empresa: "Empresa Test",
      email_sent: 1,
    });
  });

  it("valida los datos y exige el consentimiento", async () => {
    const { app } = setup();
    expect((await (await post(app, { ...lead, email: "no-es-un-email" })).json()).error).toMatch(/Email/);
    expect((await post(app, { ...lead, consentimiento: false })).status).toBe(400);
    expect((await post(app, { ...lead, comerciales: "mil" })).status).toBe(400);
  });

  it("guarda qué versión de la política de privacidad se aceptó", async () => {
    const { app, db, sent } = setup();
    await post(app, lead);
    expect(db.prepare("SELECT consent_version FROM leads").get()).toEqual({ consent_version: LEGAL_VERSION });
    expect(String(sent[0]?.body.htmlContent)).toContain(`versión ${LEGAL_VERSION}`);
  });

  it("borra las solicitudes de más de 2 años, como dice la política", async () => {
    const { app, db, leads } = setup();
    await post(app, lead);
    const now = Date.now();
    db.prepare("UPDATE leads SET created_ms = ?").run(now - 731 * 86400_000);
    await post(app, { ...lead, email: "reciente@empresa.test" });
    expect(leads.prune(now)).toBe(1);
    expect(db.prepare("SELECT email FROM leads").all()).toEqual([{ email: "reciente@empresa.test" }]);
  });

  it("a un bot que rellena el campo trampa le dice que sí, pero no guarda nada", async () => {
    const { app, db, sent } = setup();
    expect((await post(app, { ...lead, web: "http://spam.test" })).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM leads").get()).toEqual({ n: 0 });
    expect(sent).toHaveLength(0);
  });

  it("limita a 5 solicitudes por IP y hora", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) expect((await post(app, lead, "9.9.9.9")).status).toBe(200);
    expect((await post(app, lead, "9.9.9.9")).status).toBe(429);
    expect((await post(app, lead, "8.8.8.8")).status).toBe(200);
  });

  it("si Brevo falla, la solicitud no se pierde: queda guardada con el error", async () => {
    const { app, db } = setup(async () => new Response("caído", { status: 400 }));
    expect((await post(app, lead)).status).toBe(200);
    const row = db.prepare("SELECT email_sent, email_error FROM leads").get() as {
      email_sent: number;
      email_error: string;
    };
    expect(row.email_sent).toBe(0);
    expect(row.email_error).toMatch(/Brevo 400/);
  });

  it("sin destinatario configurado no envía nada, pero guarda la solicitud", async () => {
    const db = memDb();
    let calls = 0;
    const mailer = new LeadMailer({
      apiKey: "clave",
      to: "",
      from: "avisos@equipo.test",
      fromName: "Ringover 4Geeks",
      fetchImpl: async () => {
        calls++;
        return new Response("{}", { status: 201 });
      },
    });
    const leads = new Leads(db, mailer);
    expect(mailer.enabled).toBe(false);
    expect(leads.notifyTo).toBeNull();
    const r = await leads.create(leadSchema.parse(lead), { ip: "1.1.1.1", userAgent: null });
    expect(r.emailed).toBe(false);
    expect(calls).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM leads").get()).toEqual({ n: 1 });
  });

  it("rechaza envíos desde otros sitios", async () => {
    const { app } = setup();
    const res = await app.request("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://malo.test", host: "ringover.test" },
      body: JSON.stringify(lead),
    });
    expect(res.status).toBe(403);
  });
});

describe("portada, SEO e indexación", () => {
  it("sin sesión, la portada es la landing ya renderizada e indexable", async () => {
    const { app } = setup();
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Analítica de llamadas e IA para Ringover");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("vary")).toContain("Cookie");
  });

  it("aviso legal, privacidad y cookies son públicas e indexables", async () => {
    const { app } = setup();
    const res = await app.request("/privacidad");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(await res.text()).toContain('data-legal="privacidad"');
  });

  it("las rutas del panel no se indexan", async () => {
    const { app } = setup();
    const res = await app.request("/llamadas");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await res.text()).toContain('<div id="root"></div>');
  });
});

describe("solicitudes en el panel", () => {
  it("la lista de solicitudes es solo para admins (y no es pública)", async () => {
    const { app } = setup();
    await post(app, lead);
    expect((await app.request("/api/admin/leads")).status).toBe(401);
  });
});
