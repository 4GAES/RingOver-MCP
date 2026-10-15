import { errMsg, log } from "../log";
import {
  callsPage,
  firstArray,
  type Presence,
  presence,
  type RingoverCall,
  type RingoverUser,
  ringoverCall,
  ringoverUser,
} from "./schemas";

export class RingoverError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Separación mínima entre peticiones (la API admite 2 por segundo). */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Cliente de la API pública de Ringover con:
 * - cola con ritmo fijo (respeta el límite de 2 peticiones/s de la clave),
 * - timeout por petición,
 * - reintentos con espera exponencial + jitter (y Retry-After si llega),
 * - cortacircuitos: tras varios fallos seguidos deja de llamar un rato.
 */
export class RingoverClient {
  private readonly o: Required<ClientOptions>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(opts: ClientOptions) {
    this.o = {
      minIntervalMs: 550,
      timeoutMs: 20_000,
      maxRetries: 5,
      fetchImpl: fetch,
      sleep: realSleep,
      now: Date.now,
      ...opts,
    };
  }

  get circuitOpen(): boolean {
    return this.o.now() < this.openUntil;
  }

  /** Petición GET serializada en la cola global. */
  get(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const run = () => this.withRetry(path, params);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async withRetry(path: string, params: Record<string, string | number>): Promise<unknown> {
    if (this.circuitOpen) {
      throw new RingoverError("Ringover no responde: pausa de seguridad activa", null);
    }
    let attempt = 0;
    for (;;) {
      const wait = this.lastRequestAt + this.o.minIntervalMs - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      this.lastRequestAt = this.o.now();
      try {
        const body = await this.once(path, params);
        this.consecutiveFailures = 0;
        return body;
      } catch (e) {
        const err = e instanceof RingoverError ? e : new RingoverError(errMsg(e), null);
        const retryable = err.status === null || RETRYABLE.has(err.status);
        if (!retryable || attempt >= this.o.maxRetries) {
          if (retryable) this.registerFailure();
          throw err;
        }
        const retryAfter = (err as RingoverError & { retryAfterMs?: number }).retryAfterMs;
        const backoff = Math.min(30_000, 1000 * 2 ** attempt);
        const delay = retryAfter ?? Math.round(backoff / 2 + Math.random() * (backoff / 2));
        log.warn("ringover reintento", { path, status: err.status, attempt: attempt + 1, delay });
        await this.o.sleep(delay);
        attempt++;
      }
    }
  }

  private registerFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      this.openUntil = this.o.now() + 2 * 60_000;
      this.consecutiveFailures = 0;
      log.error("ringover cortacircuitos abierto 2 min");
    }
  }

  private async once(path: string, params: Record<string, string | number>): Promise<unknown> {
    const url = new URL(this.o.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await this.o.fetchImpl(url, {
      headers: { Authorization: this.o.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(this.o.timeoutMs),
    });
    if (res.status === 204) return {};
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      const err = new RingoverError(
        `Ringover ${res.status} en ${path}${detail ? `: ${detail}` : ""}`,
        res.status,
      ) as RingoverError & {
        retryAfterMs?: number;
      };
      const ra = Number(res.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(60_000, ra * 1000);
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /** Llamadas de una ventana (máx. 15 días según la API), todas las páginas. */
  async callsBetween(startMs: number, endMs: number): Promise<RingoverCall[]> {
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    const pageSize = 1000;
    const out: RingoverCall[] = [];
    for (let offset = 0; offset <= 9000; offset += pageSize) {
      const body = await this.get("/calls", {
        start_date: iso(startMs),
        end_date: iso(endMs),
        limit_count: pageSize,
        limit_offset: offset,
      });
      const page = callsPage.parse(body);
      const list = page.call_list ?? [];
      for (const item of list) {
        const parsed = ringoverCall.safeParse(item);
        if (parsed.success) out.push(parsed.data);
        else log.warn("llamada con formato inesperado", { issue: parsed.error.issues[0]?.message });
      }
      if (list.length < pageSize) break;
    }
    return out;
  }

  async users(): Promise<RingoverUser[]> {
    const body = await this.get("/users");
    return firstArray(body).flatMap((u) => {
      const p = ringoverUser.safeParse(u);
      return p.success ? [p.data] : [];
    });
  }

  async presences(): Promise<Presence[]> {
    const body = await this.get("/presences");
    return firstArray(body).flatMap((u) => {
      const p = presence.safeParse(u);
      return p.success ? [p.data] : [];
    });
  }
}
