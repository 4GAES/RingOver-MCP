import { describe, expect, it } from "vitest";
import { setState } from "../../src/server/db";
import { agentDetail, listCalls, numberHistory, overview } from "../../src/server/queries/metrics";
import { recomputeNewness, saveCalls, toRow } from "../../src/server/sync/calls";
import { recordPresence } from "../../src/server/sync/presence";
import { call, memDb } from "./helpers";

const NOW = Date.parse("2026-10-02T18:00:00Z"); // 20:00 en Madrid

describe("conversión de llamadas", () => {
  it("una llamada 'contestada' sin conversación no cuenta como contestada", () => {
    const row = toRow(call({ start: "2026-10-02T08:00:00Z", is_answered: true, incall_duration: 0 }));
    expect(row?.is_answered).toBe(0);
    expect(row?.incall_s).toBe(0);
  });

  it("marca como internas las extensiones y casa números por sus últimos 9 dígitos", () => {
    expect(toRow(call({ start: "2026-10-02T08:00:00Z", contact_number: "204" }))?.internal).toBe(1);
    const a = toRow(call({ start: "2026-10-02T08:00:00Z", contact_number: "+34 600 111 222" }));
    const b = toRow(call({ start: "2026-10-02T08:00:00Z", contact_number: "600111222" }));
    expect(a?.contact_key).toBe("600111222");
    expect(b?.contact_key).toBe("600111222");
  });

  it("guardar dos veces la misma llamada la actualiza, no la duplica", () => {
    const db = memDb();
    const c = call({ start: "2026-10-02T08:00:00Z", talk: 30 });
    saveCalls(db, [c]);
    saveCalls(db, [{ ...c, record: "https://example.test/rec.mp3" }]);
    const rows = db.prepare("SELECT record_url FROM calls").all() as { record_url: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.record_url).toBe("https://example.test/rec.mp3");
  });
});

describe("llamadas nuevas y antiguas", () => {
  it("es nueva hasta la primera conversación; después, antigua", () => {
    const db = memDb();
    const n = "34600999888";
    saveCalls(db, [
      call({ start: "2026-10-01T08:00:00Z", contact_number: n }), // sin respuesta → nueva
      call({ start: "2026-10-01T09:00:00Z", contact_number: n, talk: 120 }), // primera conversación → nueva
      call({ start: "2026-10-02T08:00:00Z", contact_number: n, talk: 60, user: 2 }), // otro comercial → antigua
      call({ start: "2026-10-02T08:10:00Z", contact_number: "34611111111" }), // otro número → nueva
    ]);
    recomputeNewness(db);
    const flags = (
      db.prepare("SELECT is_new FROM calls ORDER BY start_ms").all() as { is_new: number }[]
    ).map((r) => r.is_new);
    expect(flags).toEqual([1, 1, 0, 1]);
  });

  it("respeta el historial previo importado (known_contacts)", () => {
    const db = memDb();
    db.prepare("INSERT INTO known_contacts VALUES (?, ?)").run(
      "600999888",
      Date.parse("2025-01-01T00:00:00Z"),
    );
    saveCalls(db, [call({ start: "2026-10-01T08:00:00Z", contact_number: "34600999888", talk: 50 })]);
    recomputeNewness(db);
    expect((db.prepare("SELECT is_new FROM calls").get() as { is_new: number }).is_new).toBe(0);
  });
});

describe("métricas", () => {
  function seeded() {
    const db = memDb();
    saveCalls(db, [
      call({ start: "2026-10-02T07:00:00Z", talk: 16 * 60, contact_number: "34600000001" }), // nueva +15
      call({ start: "2026-10-02T08:00:00Z", talk: 2 * 60, contact_number: "34600000001" }), // antigua −5
      call({ start: "2026-10-02T09:00:00Z", talk: 0, contact_number: "34600000002" }), // no contestada (no cuenta en −5)
      call({ start: "2026-10-02T10:00:00Z", talk: 7 * 60, contact_number: "34600000003", user: 2 }),
      call({ start: "2026-10-02T11:00:00Z", talk: 0, contact_number: "205" }), // interna: fuera
      call({ start: "2026-09-25T07:00:00Z", talk: 60, contact_number: "34600000009" }), // semana pasada
    ]);
    recomputeNewness(db);
    return db;
  }

  it("calcula las 9 métricas del día", () => {
    const o = overview(seeded(), "2026-10-02", "2026-10-02", {}, NOW);
    expect(o.totals).toMatchObject({
      llamadas: 4,
      contestadas: 3,
      nuevas: 3,
      antiguas: 1,
      tiempo_llamada: (16 + 2 + 7) * 60,
      mas15: 1,
      menos5: 1,
      nuevas_mas15: 1,
      tiempo_conectado: null,
    });
    expect(o.previous.llamadas).toBe(1);
    expect(o.compare.from).toBe("2026-09-25");
  });

  it("desglosa por comercial y por hora", () => {
    const o = overview(seeded(), "2026-10-02", "2026-10-02", {}, NOW);
    const byAgent = Object.fromEntries(o.agents.map((a) => [a.agent.id, a.current.llamadas]));
    expect(byAgent).toEqual({ 1: 3, 2: 1 });
    expect(o.hours.find((h) => h.hour === 9)?.nuevas).toBe(1); // 07:00 UTC = 09:00 Madrid
    expect(o.durations.find((d) => d.minute === 16)?.zone).toBe("larga");
    expect(o.series.points).toHaveLength(14);
  });

  it("el tiempo conectado solo existe desde que se mide", () => {
    const db = seeded();
    const t0 = Date.parse("2026-10-02T07:00:00Z");
    for (let i = 0; i <= 30; i++)
      recordPresence(db, [{ user_id: 1, connected_devices: 1, is_snoozed: false }], t0 + i * 60_000);
    setState(db, "presence_since_ms", t0);
    const o = overview(db, "2026-10-02", "2026-10-02", {}, NOW);
    expect(o.totals.tiempo_conectado).toBe(31 * 60);
    expect(o.previous.tiempo_conectado).toBeNull();
    expect(agentDetail(db, 1, "2026-10-02", "2026-10-02", {}, NOW)?.timeline?.segments).toHaveLength(1);
  });

  it("filtra y pagina el listado de llamadas", () => {
    const db = seeded();
    const all = listCalls(db, { from: "2026-10-02", to: "2026-10-02", limit: 2 }, NOW);
    expect(all.total).toBe(4);
    expect(all.items).toHaveLength(2);
    const rest = listCalls(db, { from: "2026-10-02", to: "2026-10-02", limit: 2, cursor: all.next }, NOW);
    expect(rest.items.map((c) => c.id)).not.toContain(all.items[0]?.id);
    expect(listCalls(db, { from: "2026-10-02", to: "2026-10-02", duracion: "menos5" }, NOW).total).toBe(1);
    expect(listCalls(db, { from: "2026-10-02", to: "2026-10-02", numero: "600 000 001" }, NOW).total).toBe(2);
  });

  it("devuelve el historial completo de un número", () => {
    const h = numberHistory(seeded(), "+34600000001");
    expect(h?.calls).toHaveLength(2);
    expect(h?.firstTalkMs).toBe(Date.parse("2026-10-02T07:00:00Z"));
  });
});

describe("histórico", () => {
  it("se detiene en el límite de un año y da por terminada la carga si Ringover responde 400", async () => {
    const { backfill, RETENTION_MS } = await import("../../src/server/sync/calls");
    const { RingoverError } = await import("../../src/server/ringover/client");
    const { getState } = await import("../../src/server/db");
    const db = memDb();
    const now = Date.parse("2026-10-02T12:00:00Z");
    const windows: [number, number][] = [];
    const client = {
      callsBetween: async (s: number, e: number) => {
        windows.push([s, e]);
        if (windows.length === 3) throw new RingoverError("Ringover 400 en /calls", 400);
        return [call({ start: new Date(e - 3600_000).toISOString(), talk: 30 })];
      },
    } as never;
    await backfill(db, client, now);
    expect(getState(db, "backfill_done")).toBe("1");
    expect(windows).toHaveLength(3);
    expect(Math.min(...windows.map((w) => w[0]))).toBeGreaterThanOrEqual(now - RETENTION_MS);
    expect(getState(db, "history_from_ms")).not.toBeNull();
  });

  it("el recálculo parcial solo toca los números sincronizados", () => {
    const db = memDb();
    saveCalls(db, [call({ start: "2026-10-01T08:00:00Z", contact_number: "34600000077", talk: 60 })], 1000);
    db.prepare("UPDATE calls SET is_new = 0").run(); // estado incoherente a propósito
    saveCalls(db, [call({ start: "2026-10-02T08:00:00Z", contact_number: "34600000088", talk: 60 })], 5000);
    recomputeNewness(db, 5000);
    const rows = db.prepare("SELECT contact_key, is_new FROM calls ORDER BY start_ms").all();
    expect(rows).toEqual([
      { contact_key: "600000077", is_new: 0 }, // no se tocó
      { contact_key: "600000088", is_new: 1 },
    ]);
    recomputeNewness(db);
    expect((db.prepare("SELECT SUM(is_new) AS n FROM calls").get() as { n: number }).n).toBe(2);
  });
});
