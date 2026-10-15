import type { DB } from "../db";

// Quién puede entrar con Google: los admins fijos (ADMIN_EMAILS) y la lista que
// gestionan los admins desde el panel. Quien entra con la cuenta de Center no pasa
// por aquí: conserva los permisos que tenga en Center.

export type Role = "admin" | "viewer";

export interface UserRow {
  email: string;
  name: string | null;
  role: Role;
  added_by: string | null;
  created_ms: number;
  last_login_ms: number | null;
}

export interface UserListItem extends UserRow {
  /** Admin fijo por configuración: no se puede quitar ni degradar desde el panel. */
  fixed: boolean;
}

export const normEmail = (e: string) => e.trim().toLowerCase();

export class Users {
  private readonly admins: Set<string>;

  constructor(
    private readonly db: DB,
    adminEmails: string,
  ) {
    this.admins = new Set(adminEmails.split(",").map(normEmail).filter(Boolean));
  }

  isFixedAdmin(email: string): boolean {
    return this.admins.has(normEmail(email));
  }

  get(email: string): UserRow | null {
    return (
      (this.db.prepare("SELECT * FROM users WHERE email = ?").get(normEmail(email)) as UserRow | undefined) ??
      null
    );
  }

  /** Rol con el que entra esa cuenta por Google; null si no tiene acceso. */
  access(email: string): Role | null {
    if (this.isFixedAdmin(email)) return "admin";
    return this.get(email)?.role ?? null;
  }

  list(): UserListItem[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY role, email").all() as unknown as UserRow[];
    const byEmail = new Map(rows.map((r) => [r.email, r]));
    const fixed: UserListItem[] = [...this.admins].map((email) => ({
      ...(byEmail.get(email) ?? { email, name: null, added_by: null, created_ms: 0, last_login_ms: null }),
      role: "admin",
      fixed: true,
    }));
    return [...fixed, ...rows.filter((r) => !this.admins.has(r.email)).map((r) => ({ ...r, fixed: false }))];
  }

  add(email: string, role: Role, by: string, now = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO users (email, role, added_by, created_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET role = excluded.role`,
      )
      .run(normEmail(email), role, normEmail(by), now);
  }

  setRole(email: string, role: Role): boolean {
    return (
      this.db.prepare("UPDATE users SET role = ? WHERE email = ?").run(role, normEmail(email)).changes > 0
    );
  }

  remove(email: string): boolean {
    return this.db.prepare("DELETE FROM users WHERE email = ?").run(normEmail(email)).changes > 0;
  }

  /** Apunta el último acceso (y el nombre que da Google). Los admins fijos se guardan al primer login. */
  touchLogin(email: string, name: string | null, now = Date.now()) {
    const e = normEmail(email);
    if (this.isFixedAdmin(e) && !this.get(e)) {
      this.db
        .prepare(
          "INSERT INTO users (email, name, role, added_by, created_ms, last_login_ms) VALUES (?, ?, 'admin', 'config', ?, ?)",
        )
        .run(e, name, now, now);
      return;
    }
    this.db
      .prepare("UPDATE users SET last_login_ms = ?, name = COALESCE(?, name) WHERE email = ?")
      .run(now, name, e);
  }
}
