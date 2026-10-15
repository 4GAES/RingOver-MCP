import { defineConfig, devices } from "@playwright/test";

// El panel se prueba compilado y servido por el propio servidor, con datos de demo y
// el login de Center simulado: igual que en producción salvo la fuente de datos.
const PORT = 3021;
export const AUTH = "test-results/.auth/demo.json";
const env = {
  NODE_ENV: "development",
  PORT: String(PORT),
  DB_PATH: "./data/e2e.db",
  STATIC_DIR: "./dist/web",
  CENTER_URL: "http://127.0.0.1:8098",
  CENTER_PUBLIC_URL: "http://127.0.0.1:8098",
  PUBLIC_URL: `http://127.0.0.1:${PORT}`,
  GOOGLE_CLIENT_ID: "cliente-e2e",
  GOOGLE_CLIENT_SECRET: "secreto-e2e",
  GOOGLE_AUTH_URL: "http://127.0.0.1:8098/google/auth",
  GOOGLE_TOKEN_URL: "http://127.0.0.1:8098/google/token",
  ADMIN_EMAILS: "admin@equipo.test",
  GOOGLE_ALLOWED_DOMAIN: "equipo.test",
  MCP_TOKEN: "e2e-token-solo-pruebas-000000000000000",
  COOKIE_SECURE: "false",
  SYNC_ENABLED: "false",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    channel: "chrome",
  },
  projects: [
    // Se entra una sola vez y se reutiliza la sesión (el login tiene límite de intentos).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "escritorio",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
        storageState: AUTH,
      },
      testIgnore: /movil\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "movil",
      use: { ...devices["Pixel 7"], channel: "chrome", storageState: AUTH },
      testMatch: /movil\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node scripts/mock-center.mjs",
      env: { MOCK_CENTER_PORT: "8098" },
      url: "http://127.0.0.1:8098/api/auth/me",
      reuseExistingServer: false,
      ignoreHTTPSErrors: true,
      timeout: 10_000,
    },
    {
      command:
        "npm run build:web && node --import tsx scripts/seed-demo.ts && node --import tsx src/server/index.ts",
      env: { ...env },
      url: `http://127.0.0.1:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
