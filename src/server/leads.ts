import { z } from "zod";
import { LEAD_RETENTION_DAYS, LEGAL_VERSION } from "../shared/legal";
import type { DB } from "./db";
import { errMsg, log } from "./log";

// Solicitudes de acceso de la landing: se guardan siempre y se avisan por email (Brevo).
// Si el email falla, la solicitud no se pierde: queda en la base con el error.
// Cada solicitud guarda la versión de la política de privacidad aceptada (RGPD art. 7.1)
// y se borra sola a los LEAD_RETENTION_DAYS días (lo que dice la política).

export const COMPANY_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;

export const leadSchema = z.object({
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(120),
  email: z.email("Email no válido").max(200),
  empresa: z.string().trim().min(2, "Escribe el nombre de tu empresa").max(160),
  comerciales: z.enum(COMPANY_SIZES, { message: "Elige el tamaño del equipo" }),
  telefono: z.string().trim().max(40).optional().default(""),
  mensaje: z.string().trim().max(2000).optional().default(""),
  consentimiento: z.literal(true, { message: "Necesitamos tu consentimiento para contactarte" }),
  // Campo trampa: los humanos no lo ven; los bots lo rellenan.
  web: z.string().max(0).optional().default(""),
});
export type Lead = z.infer<typeof leadSchema>;

export interface MailerOptions {
  apiKey: string;
  to: string;
  from: string;
  fromName: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export class LeadMailer {
  private readonly f: typeof fetch;
  constructor(private readonly o: MailerOptions) {
    this.f = o.fetchImpl ?? fetch;
  }

  get enabled() {
    return Boolean(this.o.apiKey && this.o.to && this.o.from);
  }

  /** A quién llegan los avisos (para enseñarlo a los admins en el panel). */
  get recipient() {
    return this.o.to || null;
  }

  /** Envía el aviso con reintentos (2) ante fallo de red o 5xx de Brevo. */
  async send(lead: Lead, id: number): Promise<void> {
    const rows: [string, string][] = [
      ["Nombre", lead.nombre],
      ["Email", lead.email],
      ["Empresa", lead.empresa],
      ["Comerciales", lead.comerciales],
      ["Teléfono", lead.telefono || "—"],
      ["Mensaje", lead.mensaje || "—"],
    ];
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#0b0b0b">
<h2 style="margin:0 0 4px">Nueva solicitud de acceso</h2>
<p style="margin:0 0 16px;color:#52514e">Ringover 4Geeks · landing · solicitud #${id}</p>
<table cellpadding="8" style="border-collapse:collapse">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="color:#898781;vertical-align:top">${k}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`,
      )
      .join("")}</table>
<p style="margin-top:16px;color:#898781;font-size:13px">Responde a este email para escribir directamente a ${esc(lead.nombre)}.<br>Aceptó la política de privacidad (versión ${LEGAL_VERSION}): usa estos datos solo para responder a su solicitud.</p></div>`;
    const body = JSON.stringify({
      sender: { email: this.o.from, name: this.o.fromName },
      to: [{ email: this.o.to }],
      replyTo: { email: lead.email, name: lead.nombre },
      subject: `Nueva solicitud · Ringover 4Geeks · ${lead.empresa}`,
      htmlContent: html,
      textContent: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
      tags: ["ringover-landing"],
    });
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.f("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": this.o.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000),
        });
        if (res.ok) return;
        lastError = `Brevo ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastError = errMsg(e);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 300));
    }
    throw new Error(lastError || "Brevo no respondió");
  }
}

export interface LeadRow {
  id: number;
  created_ms: number;
  nombre: string;
  email: string;
  empresa: string;
  comerciales: string;
  telefono: string | null;
  mensaje: string | null;
  email_sent: number;
  email_error: string | null;
}

export class Leads {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly db: DB,
    private readonly mailer: LeadMailer,
  ) {}

  /** A quién se avisa por email (null si el envío no está configurado). */
  get notifyTo(): string | null {
    return this.mailer.enabled ? this.mailer.recipient : null;
  }

  /** Máximo 5 solicitudes por IP y hora. */
  allow(ip: string, now = Date.now()): boolean {
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= 5) return false;
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }

  /** Borra las solicitudes que han superado el plazo de conservación. */
  prune(now = Date.now()): number {
    const r = this.db
      .prepare("DELETE FROM leads WHERE created_ms < ?")
      .run(now - LEAD_RETENTION_DAYS * 86400_000);
    return Number(r.changes);
  }

  list(limit = 100) {
    return this.db
      .prepare(
        `SELECT id, created_ms, nombre, email, empresa, comerciales, telefono, mensaje, email_sent, email_error
         FROM leads ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as unknown as LeadRow[];
  }

  async create(lead: Lead, meta: { ip: string; userAgent: string | null }, now = Date.now()) {
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO leads (created_ms, nombre, email, empresa, comerciales, telefono, mensaje, ip, user_agent, consent_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          now,
          lead.nombre,
          lead.email.toLowerCase(),
          lead.empresa,
          lead.comerciales,
          lead.telefono || null,
          lead.mensaje || null,
          meta.ip,
          meta.userAgent?.slice(0, 300) ?? null,
          LEGAL_VERSION,
        ).lastInsertRowid,
    );
    if (!this.mailer.enabled) {
      log.warn("lead guardado sin email (faltan BREVO_API_KEY, LEADS_TO o LEADS_FROM)", { id });
      return { id, emailed: false };
    }
    try {
      await this.mailer.send(lead, id);
      this.db.prepare("UPDATE leads SET email_sent = 1 WHERE id = ?").run(id);
      log.info("lead enviado", { id, empresa: lead.empresa });
      return { id, emailed: true };
    } catch (e) {
      this.db.prepare("UPDATE leads SET email_error = ? WHERE id = ?").run(errMsg(e).slice(0, 500), id);
      log.error("lead guardado pero el email falló", { id, error: errMsg(e) });
      return { id, emailed: false };
    }
  }
}
