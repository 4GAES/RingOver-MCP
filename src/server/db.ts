import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

// Cada migración se aplica una sola vez y en orden; nunca se edita una ya publicada.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE calls (
    cdr_id          INTEGER PRIMARY KEY,
    call_id         TEXT,
    direction       TEXT NOT NULL,
    type            TEXT,
    last_state      TEXT,
    is_answered     INTEGER NOT NULL DEFAULT 0,
    start_ms        INTEGER NOT NULL,
    answered_ms     INTEGER,
    end_ms          INTEGER,
    day             TEXT NOT NULL,
    hour            INTEGER NOT NULL,
    incall_s        INTEGER NOT NULL DEFAULT 0,
    total_s         INTEGER NOT NULL DEFAULT 0,
    ringing_s       INTEGER NOT NULL DEFAULT 0,
    hold_s          INTEGER NOT NULL DEFAULT 0,
    queue_s         INTEGER NOT NULL DEFAULT 0,
    user_id         INTEGER,
    contact_number  TEXT,
    contact_key     TEXT,
    contact_name    TEXT,
    hangup_by       TEXT,
    record_url      TEXT,
    tags            TEXT,
    internal        INTEGER NOT NULL DEFAULT 0,
    is_new          INTEGER NOT NULL DEFAULT 0,
    raw             TEXT,
    synced_at       INTEGER NOT NULL
  );
  CREATE INDEX calls_start ON calls(start_ms);
  CREATE INDEX calls_day_user ON calls(day, user_id);
  CREATE INDEX calls_contact ON calls(contact_key, start_ms);

  CREATE TABLE agents (
    user_id     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    firstname   TEXT,
    lastname    TEXT,
    email       TEXT,
    initials    TEXT,
    color       TEXT,
    picture     TEXT,
    updated_at  INTEGER NOT NULL
  );

  -- Primer contacto conocido de números anteriores al histórico de la API (opcional).
  CREATE TABLE known_contacts (
    contact_key       TEXT PRIMARY KEY,
    first_answered_ms INTEGER NOT NULL
  );

  -- Tramos de conexión a Ringover medidos por la app (no existen en la API).
  CREATE TABLE presence_segments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    start_ms  INTEGER NOT NULL,
    end_ms    INTEGER NOT NULL,
    snoozed   INTEGER NOT NULL DEFAULT 0,
    open      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX presence_user_time ON presence_segments(user_id, start_ms);
  CREATE INDEX presence_time ON presence_segments(start_ms, end_ms);

  -- Último estado visto por comercial (para "ahora mismo").
  CREATE TABLE presence_now (
    user_id          INTEGER PRIMARY KEY,
    connected        INTEGER NOT NULL,
    in_call          INTEGER NOT NULL,
    snoozed          INTEGER NOT NULL,
    devices          INTEGER NOT NULL,
    seen_ms          INTEGER NOT NULL,
    state_since_ms   INTEGER NOT NULL
  );

  CREATE TABLE sync_state (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id             TEXT PRIMARY KEY,
    center_token   TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    email          TEXT NOT NULL,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL,
    created_ms     INTEGER NOT NULL,
    expires_ms     INTEGER NOT NULL,
    checked_ms     INTEGER NOT NULL
  );
  `,
  // 2 — Login con Google: lista de usuarios que gestionan los admins y origen de cada sesión.
  `
  CREATE TABLE users (
    email          TEXT PRIMARY KEY,
    name           TEXT,
    role           TEXT NOT NULL DEFAULT 'viewer',
    added_by       TEXT,
    created_ms     INTEGER NOT NULL,
    last_login_ms  INTEGER
  );
  ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'center';
  `,
  // 3 — MCP: tokens por usuario, conexiones OAuth (Claude, ChatGPT…) y registro de uso.
  `
  CREATE TABLE api_tokens (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,            -- personal | oauth
    name            TEXT NOT NULL,
    hash            TEXT UNIQUE,              -- solo tokens personales (sha256)
    prefix          TEXT,
    owner_email     TEXT NOT NULL,
    owner_name      TEXT,
    owner_provider  TEXT NOT NULL,            -- google | center | config
    owner_role      TEXT NOT NULL,
    client_id       TEXT,
    created_ms      INTEGER NOT NULL,
    expires_ms      INTEGER,
    last_used_ms    INTEGER,
    last_ip         TEXT,
    last_client     TEXT,
    revoked_ms      INTEGER,
    revoked_by      TEXT
  );
  CREATE INDEX api_tokens_owner ON api_tokens(owner_email);

  CREATE TABLE oauth_clients (
    client_id      TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    redirect_uris  TEXT NOT NULL,
    created_ms     INTEGER NOT NULL
  );

  CREATE TABLE oauth_codes (
    hash            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    challenge       TEXT NOT NULL,
    owner_email     TEXT NOT NULL,
    owner_name      TEXT,
    owner_provider  TEXT NOT NULL,
    owner_role      TEXT NOT NULL,
    expires_ms      INTEGER NOT NULL,
    used            INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE oauth_tokens (
    hash        TEXT PRIMARY KEY,
    grant_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,                -- access | refresh
    expires_ms  INTEGER NOT NULL,
    used_ms     INTEGER,
    created_ms  INTEGER NOT NULL
  );
  CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);

  CREATE TABLE mcp_calls (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms        INTEGER NOT NULL,
    token_id     TEXT,
    owner_email  TEXT,
    client       TEXT,
    method       TEXT NOT NULL,
    tool         TEXT,
    args         TEXT,
    status       TEXT NOT NULL,               -- ok | error | denied | rate_limited
    error        TEXT,
    duration_ms  INTEGER NOT NULL DEFAULT 0,
    bytes_out    INTEGER NOT NULL DEFAULT 0,
    ip           TEXT
  );
  CREATE INDEX mcp_calls_ts ON mcp_calls(ts_ms);
  CREATE INDEX mcp_calls_token ON mcp_calls(token_id, ts_ms);
  CREATE INDEX mcp_calls_owner ON mcp_calls(owner_email, ts_ms);
  `,
  // 4 — Solicitudes de acceso desde la landing.
  `
  CREATE TABLE leads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_ms   INTEGER NOT NULL,
    nombre       TEXT NOT NULL,
    email        TEXT NOT NULL,
    empresa      TEXT NOT NULL,
    comerciales  TEXT NOT NULL,
    telefono     TEXT,
    mensaje      TEXT,
    ip           TEXT,
    user_agent   TEXT,
    email_sent   INTEGER NOT NULL DEFAULT 0,
    email_error  TEXT
  );
  CREATE INDEX leads_created ON leads(created_ms);
  `,
  // 5 — Prueba del consentimiento: qué versión de la política de privacidad se aceptó.
  `
  ALTER TABLE leads ADD COLUMN consent_version TEXT;
  `,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
  );
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version] as string;
    tx(db, () => {
      db.exec(sql);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
    });
    version++;
  }
}

/** Ejecuta fn dentro de una transacción. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getState(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setState(db: DB, key: string, value: string | number) {
  db.prepare(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}
