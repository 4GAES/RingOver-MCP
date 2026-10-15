import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { McpTokenItem } from "../../shared/api";
import { DAY_MS, localDay, localToUtc } from "../../shared/time";
import { type DB, tx } from "../db";
import type { Users } from "./users";

// Tokens del MCP. Hay tres tipos:
//  - personal: lo genera cada usuario en el panel; el secreto solo se enseña una vez.
//  - oauth: una "conexión" autorizada desde Claude, ChatGPT… (sus tokens rotan solos).
//  - config: el token heredado de la variable MCP_TOKEN (para no romper lo ya conectado).
// De todos se guarda solo el hash; quien usa el token actúa con los permisos de su dueño.

export interface Owner {
  email: string;
  name: string | null;
  provider: "google" | "center" | "config";
  role: string;
}

export interface Identity {
  tokenId: string;
  tokenName: string;
  kind: "personal" | "oauth" | "config";
  owner: Owner;
}

interface TokenRow {
  id: string;
  kind: "personal" | "oauth";
  name: string;
  hash: string | null;
  prefix: string | null;
  owner_email: string;
  owner_name: string | null;
  owner_provider: Owner["provider"];
  owner_role: string;
  client_id: string | null;
  created_ms: number;
  expires_ms: number | null;
  last_used_ms: number | null;
  last_ip: string | null;
  last_client: string | null;
  revoked_ms: number | null;
}

export const ACCESS_TTL_MS = 3600_000;
export const REFRESH_TTL_MS = 30 * DAY_MS;
export const CONFIG_TOKEN_ID = "config";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = (prefix: string) => `${prefix}${randomBytes(30).toString("base64url")}`;
const newId = () => `tok_${randomBytes(9).toString("base64url")}`;

export type Resolve = { ok: true; identity: Identity } | { ok: false; reason: string; tokenId?: string };

export class ApiTokens {
  constructor(
    private readonly db: DB,
    private readonly users: Users,
    private readonly legacyToken: string,
  ) {}

  /** Token personal nuevo. Devuelve el secreto (solo esta vez). */
  createPersonal(owner: Owner, name: string, expiresDays: number | null, now = Date.now()) {
    const token = secret("rgo_p_");
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO api_tokens (id, kind, name, hash, prefix, owner_email, owner_name, owner_provider, owner_role, created_ms, expires_ms)
         VALUES (?, 'personal', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name.trim().slice(0, 80) || "Token sin nombre",
        sha256(token),
        token.slice(0, 12),
        owner.email.toLowerCase(),
        owner.name,
        owner.provider,
        owner.role,
        now,
        expiresDays ? now + expiresDays * DAY_MS : null,
      );
    return { token, id };
  }

  /** Conexión OAuth (una por autorización) con su primer par de tokens. */
  createGrant(owner: Owner, clientId: string, clientName: string, now = Date.now()) {
    const id = newId();
    this.db
      .prepare(
        `INSERT INTO api_tokens (id, kind, name, owner_email, owner_name, owner_provider, owner_role, client_id, created_ms)
         VALUES (?, 'oauth', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, clientName, owner.email.toLowerCase(), owner.name, owner.provider, owner.role, clientId, now);
    return { grantId: id, ...this.issue(id, now) };
  }

  private issue(grantId: string, now: number) {
    const access = secret("rgo_a_");
    const refresh = secret("rgo_r_");
    const ins = this.db.prepare(
      "INSERT INTO oauth_tokens (hash, grant_id, kind, expires_ms, created_ms) VALUES (?, ?, ?, ?, ?)",
    );
    ins.run(sha256(access), grantId, "access", now + ACCESS_TTL_MS, now);
    ins.run(sha256(refresh), grantId, "refresh", now + REFRESH_TTL_MS, now);
    return { access, refresh, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
  }

  /**
   * Rota un refresh token. Si llega uno ya usado (posible robo), se revoca toda la
   * conexión: tanto el atacante como el cliente legítimo tendrán que volver a autorizar.
   */
  refresh(refreshToken: string, clientId: string, now = Date.now()) {
    return tx(this.db, () => {
      const row = this.db
        .prepare("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'")
        .get(sha256(refreshToken)) as
        | { grant_id: string; expires_ms: number; used_ms: number | null }
        | undefined;
      if (!row) return null;
      const grant = this.row(row.grant_id);
      if (!grant || grant.revoked_ms || grant.client_id !== clientId) return null;
      if (row.used_ms) {
        this.revoke(grant.id, "reutilización de refresh token", now);
        return null;
      }
      if (row.expires_ms < now) return null;
      this.db.prepare("UPDATE oauth_tokens SET used_ms = ? WHERE hash = ?").run(now, sha256(refreshToken));
      return this.issue(grant.id, now);
    });
  }

  private row(id: string): TokenRow | null {
    return (this.db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(id) as TokenRow | undefined) ?? null;
  }

  /** ¿A quién pertenece este token? Comprueba caducidad, revocación y que el dueño siga teniendo acceso. */
  resolve(bearer: string, now = Date.now()): Resolve {
    if (!bearer) return { ok: false, reason: "Falta el token" };
    if (this.legacyToken && safeEqual(bearer, this.legacyToken)) {
      return {
        ok: true,
        identity: {
          tokenId: CONFIG_TOKEN_ID,
          tokenName: "Token de configuración (heredado)",
          kind: "config",
          owner: { email: "sistema", name: "Configuración del servidor", provider: "config", role: "admin" },
        },
      };
    }
    const h = sha256(bearer);
    let row = this.db.prepare("SELECT * FROM api_tokens WHERE hash = ? AND kind = 'personal'").get(h) as
      | TokenRow
      | undefined;
    if (!row) {
      const t = this.db
        .prepare("SELECT grant_id, expires_ms FROM oauth_tokens WHERE hash = ? AND kind = 'access'")
        .get(h) as { grant_id: string; expires_ms: number } | undefined;
      if (!t) return { ok: false, reason: "Token desconocido" };
      if (t.expires_ms < now) return { ok: false, reason: "Token caducado", tokenId: t.grant_id };
      row = this.row(t.grant_id) ?? undefined;
      if (!row) return { ok: false, reason: "Conexión inexistente" };
    }
    if (row.revoked_ms) return { ok: false, reason: "Token revocado", tokenId: row.id };
    if (row.expires_ms && row.expires_ms < now)
      return { ok: false, reason: "Token caducado", tokenId: row.id };

    let role = row.owner_role;
    if (row.owner_provider === "google") {
      // Si a la persona le quitan el acceso en /usuarios, sus tokens dejan de valer al momento.
      const r = this.users.access(row.owner_email);
      if (!r) return { ok: false, reason: "La persona ya no tiene acceso", tokenId: row.id };
      role = r;
    }
    return {
      ok: true,
      identity: {
        tokenId: row.id,
        tokenName: row.name,
        kind: row.kind,
        owner: { email: row.owner_email, name: row.owner_name, provider: row.owner_provider, role },
      },
    };
  }

  /** Dueño de un token (aunque esté revocado o caducado), para atribuir intentos fallidos. */
  ownerOf(id: string | undefined): string | null {
    if (!id) return null;
    return this.row(id)?.owner_email ?? null;
  }

  touch(id: string, ip: string, client: string | null, now = Date.now()) {
    if (id === CONFIG_TOKEN_ID) return;
    this.db
      .prepare(
        "UPDATE api_tokens SET last_used_ms = ?, last_ip = ?, last_client = COALESCE(?, last_client) WHERE id = ?",
      )
      .run(now, ip, client, id);
  }

  canManage(id: string, email: string, admin: boolean): boolean {
    const row = this.row(id);
    return !!row && (admin || row.owner_email === email.toLowerCase());
  }

  revoke(id: string, by: string, now = Date.now()): boolean {
    const changed = this.db
      .prepare("UPDATE api_tokens SET revoked_ms = ?, revoked_by = ? WHERE id = ? AND revoked_ms IS NULL")
      .run(now, by, id).changes;
    this.db.prepare("DELETE FROM oauth_tokens WHERE grant_id = ?").run(id);
    return changed > 0;
  }

  /** Revoca todo lo de una persona (al quitarle el acceso). */
  revokeAllFor(email: string, by: string, now = Date.now()) {
    const ids = this.db
      .prepare("SELECT id FROM api_tokens WHERE owner_email = ? AND revoked_ms IS NULL")
      .all(email.toLowerCase()) as { id: string }[];
    for (const { id } of ids) this.revoke(id, by, now);
    return ids.length;
  }

  list(opts: { ownerEmail?: string; includeConfig?: boolean }, now = Date.now()): McpTokenItem[] {
    const dayStart = localToUtc(localDay(now));
    const since30 = now - 30 * DAY_MS;
    const where = opts.ownerEmail ? "WHERE t.owner_email = ?" : "";
    const params = opts.ownerEmail ? [opts.ownerEmail.toLowerCase()] : [];
    const rows = this.db
      .prepare(
        `SELECT t.*,
           (SELECT COUNT(*) FROM mcp_calls m WHERE m.token_id = t.id AND m.ts_ms >= ? AND m.method = 'tools/call') AS calls30,
           (SELECT COUNT(*) FROM mcp_calls m WHERE m.token_id = t.id AND m.ts_ms >= ? AND m.method = 'tools/call') AS calls_today
         FROM api_tokens t ${where}
         ORDER BY (t.revoked_ms IS NOT NULL), COALESCE(t.last_used_ms, t.created_ms) DESC`,
      )
      .all(since30, dayStart, ...params) as unknown as (TokenRow & {
      calls30: number;
      calls_today: number;
    })[];
    const items: McpTokenItem[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      prefix: r.prefix,
      owner: { email: r.owner_email, name: r.owner_name, provider: r.owner_provider },
      clientId: r.client_id,
      createdMs: r.created_ms,
      expiresMs: r.expires_ms,
      lastUsedMs: r.last_used_ms,
      lastClient: r.last_client,
      revokedMs: r.revoked_ms,
      status: r.revoked_ms ? "revocado" : r.expires_ms && r.expires_ms < now ? "caducado" : "activo",
      calls30d: Number(r.calls30),
      callsToday: Number(r.calls_today),
    }));
    if (opts.includeConfig && this.legacyToken) {
      const c = this.db
        .prepare(
          `SELECT MAX(ts_ms) AS last, SUM(ts_ms >= ?) AS c30, SUM(ts_ms >= ?) AS today, MAX(client) AS client
           FROM mcp_calls WHERE token_id = ? AND method = 'tools/call'`,
        )
        .get(since30, dayStart, CONFIG_TOKEN_ID) as {
        last: number | null;
        c30: number | null;
        today: number | null;
        client: string | null;
      };
      items.push({
        id: CONFIG_TOKEN_ID,
        kind: "config",
        name: "Token de configuración (heredado)",
        prefix: null,
        owner: { email: "sistema", name: "Configuración del servidor", provider: "config" },
        clientId: null,
        createdMs: 0,
        expiresMs: null,
        lastUsedMs: c.last,
        lastClient: c.client,
        revokedMs: null,
        status: "activo",
        calls30d: Number(c.c30 ?? 0),
        callsToday: Number(c.today ?? 0),
      });
    }
    return items;
  }

  prune(now = Date.now()) {
    this.db.prepare("DELETE FROM oauth_tokens WHERE expires_ms < ?").run(now - DAY_MS);
    this.db.prepare("DELETE FROM oauth_codes WHERE expires_ms < ?").run(now - DAY_MS);
  }
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
