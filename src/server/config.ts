import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3020),
  HOST: z.string().default("127.0.0.1"),
  DB_PATH: z.string().default("./data/ringover.db"),
  RINGOVER_API_KEY: z.string().default(""),
  RINGOVER_BASE_URL: z.url().default("https://public-api.ringover.com/v2"),
  CENTER_URL: z.url().default("http://127.0.0.1:8003"),
  CENTER_CALLS_SLUG: z.string().default("admisiones-contactabilidad"),
  // Inicio de sesión único: dirección pública de Center y de esta app (para volver).
  CENTER_PUBLIC_URL: z.url().default("https://4geekscenter.duckdns.org"),
  PUBLIC_URL: z.url().default("https://ringover.duckdns.org"),
  SSO_CLIENT_ID: z.string().default("ringover"),
  // Login con Google (cliente OAuth interno de la organización 4geeksacademy.com).
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_ALLOWED_DOMAIN: z.string().default("4geeksacademy.com"),
  GOOGLE_AUTH_URL: z.url().default("https://accounts.google.com/o/oauth2/v2/auth"),
  GOOGLE_TOKEN_URL: z.url().default("https://oauth2.googleapis.com/token"),
  // Admins fijos (siempre entran y gestionan la lista de usuarios), separados por comas.
  // Los emails reales van solo en el .env del servidor, nunca en el código.
  ADMIN_EMAILS: z.string().default(""),
  // Límites de uso del MCP por token (llamadas a herramientas).
  MCP_RATE_PER_MIN: z.coerce.number().int().positive().default(60),
  MCP_RATE_PER_DAY: z.coerce.number().int().positive().default(2000),
  // Formulario de la landing: se envía por Brevo (cuenta de 4Geeks).
  BREVO_API_KEY: z.string().default(""),
  LEADS_TO: z.string().default(""),
  LEADS_FROM: z.string().default(""),
  LEADS_FROM_NAME: z.string().default("Ringover 4Geeks"),
  MCP_TOKEN: z.string().default(""),
  COOKIE_SECURE: bool.default(true),
  SYNC_ENABLED: bool.default(true),
  STATIC_DIR: z.string().default("./dist/web"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración inválida: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (cfg.SYNC_ENABLED && !cfg.RINGOVER_API_KEY) throw new Error("Falta RINGOVER_API_KEY");
    if (cfg.MCP_TOKEN && cfg.MCP_TOKEN.length < 32)
      throw new Error("MCP_TOKEN debe tener al menos 32 caracteres");
  }
  return cfg;
}
