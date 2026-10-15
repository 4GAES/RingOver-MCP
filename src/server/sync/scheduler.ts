import { localHour } from "../../shared/time";
import { type DB, setState } from "../db";
import { errMsg, log } from "../log";
import { type RingoverClient, RingoverError } from "../ringover/client";
import { backfill, reconcile, syncIncremental, upsertAgent } from "./calls";
import { recordPresence, SAMPLE_MS } from "./presence";

export type PresenceStatus = "ok" | "sin_permiso" | "error" | "pendiente";

export interface SyncStatus {
  running: boolean;
  lastCallsSyncMs: number | null;
  lastCallsError: string | null;
  presence: PresenceStatus;
  presenceError: string | null;
  backfillRunning: boolean;
}

/** Orquesta las tareas periódicas. Cada tarea tiene su propio cerrojo: nunca se solapan. */
export class Scheduler {
  readonly status: SyncStatus = {
    running: false,
    lastCallsSyncMs: null,
    lastCallsError: null,
    presence: "pendiente",
    presenceError: null,
    backfillRunning: false,
  };
  private timers: NodeJS.Timeout[] = [];
  private locks = new Set<string>();
  private lastReconcileDay = "";

  constructor(
    private readonly db: DB,
    private readonly client: RingoverClient,
  ) {}

  start() {
    this.status.running = true;
    void this.users();
    void this.calls();
    void this.presence();
    void this.history();
    this.every(SAMPLE_MS, () => this.presence());
    // Cada 3 min en horario de oficina (7-22 h Madrid), cada 30 min fuera.
    this.every(60_000, () => {
      const h = localHour(Date.now());
      const minute = new Date().getMinutes();
      const office = h >= 7 && h < 22;
      if ((office && minute % 3 === 0) || minute % 30 === 0) return this.calls();
    });
    this.every(6 * 3600_000, () => this.users());
    // Repaso nocturno de los últimos días a las 3 h.
    this.every(10 * 60_000, () => {
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      if (localHour(now) === 3 && this.lastReconcileDay !== day) {
        this.lastReconcileDay = day;
        return this.locked("reconcile", () => reconcile(this.db, this.client));
      }
    });
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.status.running = false;
  }

  private every(ms: number, fn: () => unknown) {
    this.timers.push(setInterval(() => void fn(), ms));
  }

  private async locked<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (this.locks.has(name)) return undefined;
    this.locks.add(name);
    try {
      return await fn();
    } catch (e) {
      log.error(`tarea ${name} falló`, { error: errMsg(e) });
      return undefined;
    } finally {
      this.locks.delete(name);
    }
  }

  /** Sincronización incremental de llamadas (también se lanza a mano desde el panel). */
  calls(): Promise<number | undefined> {
    return this.locked("calls", async () => {
      try {
        const n = await syncIncremental(this.db, this.client);
        this.status.lastCallsSyncMs = Date.now();
        this.status.lastCallsError = null;
        if (n) log.info("llamadas sincronizadas", { n });
        return n;
      } catch (e) {
        this.status.lastCallsError = errMsg(e);
        throw e;
      }
    });
  }

  private presence() {
    return this.locked("presence", async () => {
      try {
        const list = await this.client.presences();
        recordPresence(this.db, list);
        this.status.presence = "ok";
        this.status.presenceError = null;
      } catch (e) {
        const status = e instanceof RingoverError ? e.status : null;
        this.status.presence = status === 401 || status === 403 ? "sin_permiso" : "error";
        this.status.presenceError = errMsg(e);
        setState(this.db, "presence_status", this.status.presence);
        if (this.status.presence !== "sin_permiso") throw e;
      }
    });
  }

  private users() {
    return this.locked("users", async () => {
      try {
        const users = await this.client.users();
        for (const u of users) upsertAgent(this.db, u);
      } catch (e) {
        // Sin permiso de Monitoring solo vemos nuestro usuario: los nombres salen de las llamadas.
        log.warn("no se pudo leer la lista de usuarios", { error: errMsg(e) });
      }
    });
  }

  private history() {
    return this.locked("backfill", async () => {
      this.status.backfillRunning = true;
      try {
        await backfill(this.db, this.client);
      } finally {
        this.status.backfillRunning = false;
      }
    });
  }
}
