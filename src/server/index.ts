import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { CenterAuth } from "./auth/center";
import { GoogleAuth } from "./auth/google";
import { Sessions } from "./auth/sessions";
import { ApiTokens } from "./auth/tokens";
import { Users } from "./auth/users";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { LeadMailer, Leads } from "./leads";
import { log } from "./log";
import { McpLog } from "./mcp/log";
import { RingoverClient } from "./ringover/client";
import { Scheduler } from "./sync/scheduler";

const config = loadConfig();
const db = openDb(config.DB_PATH);
const center = new CenterAuth({ baseUrl: config.CENTER_URL, callsSlug: config.CENTER_CALLS_SLUG });
const users = new Users(db, config.ADMIN_EMAILS);
const sessions = new Sessions(db, center, users);
const tokens = new ApiTokens(db, users, config.MCP_TOKEN);
const mcpLog = new McpLog(db, { perMin: config.MCP_RATE_PER_MIN, perDay: config.MCP_RATE_PER_DAY });
const leads = new Leads(
  db,
  new LeadMailer({
    apiKey: config.BREVO_API_KEY,
    to: config.LEADS_TO,
    from: config.LEADS_FROM,
    fromName: config.LEADS_FROM_NAME,
  }),
);
// Limpieza cada hora: registro de más de 6 meses, códigos y tokens OAuth caducados y
// solicitudes de la landing fuera de plazo (política de privacidad).
setInterval(() => {
  mcpLog.prune();
  tokens.prune();
  leads.prune();
}, 3600_000).unref();
const google = new GoogleAuth({
  clientId: config.GOOGLE_CLIENT_ID,
  clientSecret: config.GOOGLE_CLIENT_SECRET,
  allowedDomain: config.GOOGLE_ALLOWED_DOMAIN,
  authUrl: config.GOOGLE_AUTH_URL,
  tokenUrl: config.GOOGLE_TOKEN_URL,
});

let scheduler: Scheduler | null = null;
if (config.SYNC_ENABLED && config.RINGOVER_API_KEY) {
  const client = new RingoverClient({ apiKey: config.RINGOVER_API_KEY, baseUrl: config.RINGOVER_BASE_URL });
  scheduler = new Scheduler(db, client);
  scheduler.start();
} else {
  log.warn("sincronización con Ringover desactivada");
}

const app = createApp({
  db,
  config,
  sessions,
  center,
  users,
  tokens,
  mcpLog,
  leads,
  google,
  allowedDomain: config.GOOGLE_ALLOWED_DOMAIN,
  status: () => ({
    backfillRunning: scheduler?.status.backfillRunning ?? false,
    lastError: scheduler?.status.lastCallsError ?? null,
  }),
  syncNow: scheduler ? () => (scheduler as Scheduler).calls() : undefined,
});

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) =>
  log.info("ringover-analitica escuchando", { port: info.port, host: config.HOST }),
);

function shutdown(signal: string) {
  log.info("parando", { signal });
  scheduler?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
