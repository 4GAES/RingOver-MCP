// La misma prueba de aceptación que se lanza contra producción, aquí contra un servidor
// local con datos de demo: protocolo, coherencia entre herramientas, validación y seguridad.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAcceptance } from "../../scripts/mcp-acceptance";
import { createApp } from "../../src/server/app";
import { CenterAuth } from "../../src/server/auth/center";
import { Sessions } from "../../src/server/auth/sessions";
import { ApiTokens } from "../../src/server/auth/tokens";
import { Users } from "../../src/server/auth/users";
import { openDb } from "../../src/server/db";
import { McpLog } from "../../src/server/mcp/log";

const PORT = 3031;
const TOKEN = "integracion-token-0000000000000000000000";
const dir = mkdtempSync(join(tmpdir(), "rg-mcp-"));
let server: ReturnType<typeof serve>;

beforeAll(() => {
  const dbPath = join(dir, "demo.db");
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--disable-warning=ExperimentalWarning", "scripts/seed-demo.ts"],
    {
      env: { ...process.env, DB_PATH: dbPath },
      stdio: "ignore",
    },
  );
  const db = openDb(dbPath);
  const users = new Users(db, "admin@equipo.test");
  const center = new CenterAuth({ baseUrl: "http://127.0.0.1:9", callsSlug: "x" });
  const app = createApp({
    db,
    config: {
      COOKIE_SECURE: false,
      MCP_TOKEN: TOKEN,
      STATIC_DIR: "./no-existe",
      NODE_ENV: "test",
      CENTER_PUBLIC_URL: "http://127.0.0.1:9",
      PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      SSO_CLIENT_ID: "ringover",
    },
    sessions: new Sessions(db, center, users),
    center,
    users,
    tokens: new ApiTokens(db, users, TOKEN),
    mcpLog: new McpLog(db, { perMin: 10_000, perDay: 100_000 }),
    status: () => ({}),
  });
  server = serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" });
}, 60_000);

afterAll(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("aceptación del MCP (cliente oficial contra servidor real)", () => {
  it("pasa todas las comprobaciones", async () => {
    const r = await runAcceptance({ url: `http://127.0.0.1:${PORT}/mcp`, token: TOKEN, perMinute: 10_000 });
    const failed = r.results.filter((x) => !x.ok).map((x) => `${x.group} · ${x.name}: ${x.detail}`);
    expect(failed).toEqual([]);
    expect(r.results.length).toBeGreaterThanOrEqual(45);
  }, 120_000);
});
