import { describe, expect, it } from "vitest";
import { connectedSeconds, recordPresence } from "../../src/server/sync/presence";
import { memDb } from "./helpers";

const T0 = Date.parse("2026-10-02T07:00:00Z");
const min = (n: number) => T0 + n * 60_000;
const on = (snoozed = false) => [{ user_id: 7, connected_devices: 1, is_snoozed: snoozed, in_call: false }];
const off = [{ user_id: 7, connected_devices: 0, is_snoozed: false, in_call: false }];

describe("tramos de conexión", () => {
  it("alarga el tramo mientras el estado no cambia", () => {
    const db = memDb();
    for (let i = 0; i < 10; i++) recordPresence(db, on(), min(i));
    expect(db.prepare("SELECT COUNT(*) AS n FROM presence_segments").get()).toEqual({ n: 1 });
    expect(connectedSeconds(db, T0, min(60)).get(7)?.connected).toBe(600);
  });

  it("corta el tramo al desconectarse y al pasar a 'no molestar'", () => {
    const db = memDb();
    recordPresence(db, on(), min(0));
    recordPresence(db, on(), min(1));
    recordPresence(db, on(true), min(2));
    recordPresence(db, off, min(3));
    recordPresence(db, on(), min(10));
    const t = connectedSeconds(db, T0, min(60)).get(7);
    expect(t).toEqual({ connected: 4 * 60, available: 3 * 60 });
  });

  it("si la app deja de muestrear, no inventa tiempo conectado", () => {
    const db = memDb();
    recordPresence(db, on(), min(0));
    recordPresence(db, on(), min(30)); // 30 min sin muestras
    expect(connectedSeconds(db, T0, min(60)).get(7)?.connected).toBe(120);
  });

  it("recorta los tramos a la ventana pedida", () => {
    const db = memDb();
    for (let i = 0; i <= 20; i++) recordPresence(db, on(), min(i));
    expect(connectedSeconds(db, min(5), min(10)).get(7)?.connected).toBe(300);
  });

  it("guarda el estado actual con desde cuándo dura", () => {
    const db = memDb();
    recordPresence(db, on(), min(0));
    recordPresence(db, [{ ...on()[0], in_call: true } as never], min(1));
    recordPresence(db, [{ ...on()[0], in_call: true } as never], min(2));
    const now = db.prepare("SELECT in_call, state_since_ms FROM presence_now").get();
    expect(now).toEqual({ in_call: 1, state_since_ms: min(1) });
  });
});
