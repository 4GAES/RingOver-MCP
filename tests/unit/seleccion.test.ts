import { describe, expect, it } from "vitest";
import { setState } from "../../src/server/db";
import { agentOptions, listCalls, overview } from "../../src/server/queries/metrics";
import { recomputeNewness, saveCalls } from "../../src/server/sync/calls";
import { recordPresence } from "../../src/server/sync/presence";
import { call, memDb } from "./helpers";

// Selección de varios comerciales en el panel: todo el Resumen se limita a ellos.

const NOW = Date.parse("2026-10-02T18:00:00Z"); // 20:00 en Madrid
const DAY = "2026-10-02";

function seeded() {
  const db = memDb();
  saveCalls(db, [
    call({ start: "2026-10-02T07:00:00Z", talk: 16 * 60, contact_number: "34600000001", user: 1 }),
    call({ start: "2026-10-02T08:00:00Z", talk: 2 * 60, contact_number: "34600000002", user: 1 }),
    // El 2 llama a un número con el que el 1 ya habló: antigua aunque solo se mire al 2.
    call({ start: "2026-10-02T09:00:00Z", talk: 7 * 60, contact_number: "34600000001", user: 2 }),
    call({ start: "2026-10-02T10:00:00Z", talk: 0, contact_number: "34600000003", user: 2 }),
    call({ start: "2026-10-02T11:00:00Z", talk: 0, contact_number: "34600000004", user: null }), // sin asignar
    call({ start: "2026-09-25T07:00:00Z", talk: 60, contact_number: "34600000009", user: 3 }), // el 3, solo la semana pasada
    call({ start: "2026-05-01T07:00:00Z", talk: 60, contact_number: "34600000010", user: 4 }), // el 4, inactivo
  ]);
  recomputeNewness(db);
  return db;
}

describe("selección de comerciales", () => {
  it("los totales, la tabla y los gráficos son solo de los elegidos", () => {
    const db = seeded();
    const o = overview(db, DAY, DAY, {}, NOW, [2]);
    expect(o.agents.map((a) => a.agent.id)).toEqual([2]);
    expect(o.totals).toMatchObject({
      llamadas: 2,
      contestadas: 1,
      nuevas: 1,
      antiguas: 1,
      tiempo_llamada: 420,
    });
    expect(o.hours.reduce((s, h) => s + h.nuevas + h.antiguas, 0)).toBe(2);
    expect(o.durations.reduce((s, d) => s + d.count, 0)).toBe(1);
    expect(o.series.points.at(-1)?.m.llamadas).toBe(2);
  });

  it("varios elegidos suman lo de cada uno", () => {
    const db = seeded();
    const all = overview(db, DAY, DAY, {}, NOW);
    const both = overview(db, DAY, DAY, {}, NOW, [1, 2]);
    expect(all.totals.llamadas).toBe(5); // incluye la llamada sin asignar
    expect(both.totals.llamadas).toBe(4);
    expect(both.agents.map((a) => a.agent.id).sort()).toEqual([1, 2]);
    expect(overview(db, DAY, DAY, {}, NOW, []).totals.llamadas).toBe(5); // vacía = todo el equipo
  });

  it("un elegido sin llamadas en el periodo sale en la tabla con ceros (y su comparación)", () => {
    const o = overview(seeded(), DAY, DAY, {}, NOW, [1, 3]);
    const tres = o.agents.find((a) => a.agent.id === 3);
    expect(tres?.current.llamadas).toBe(0);
    expect(tres?.previous.llamadas).toBe(1);
    expect(o.previous.llamadas).toBe(1);
  });

  it("las llamadas sin asignar se pueden elegir (id 0)", () => {
    const o = overview(seeded(), DAY, DAY, {}, NOW, [0]);
    expect(o.totals.llamadas).toBe(1);
    expect(o.agents.map((a) => a.agent.name)).toEqual(["Sin asignar"]);
  });

  it("el tiempo conectado también es solo de los elegidos", () => {
    const db = seeded();
    const t0 = Date.parse("2026-10-02T07:00:00Z");
    for (let i = 0; i < 10; i++) {
      recordPresence(
        db,
        [
          { user_id: 1, connected_devices: 1, is_snoozed: false },
          { user_id: 2, connected_devices: 1, is_snoozed: false },
        ],
        t0 + i * 60_000,
      );
    }
    setState(db, "presence_since_ms", t0);
    expect(overview(db, DAY, DAY, {}, NOW).totals.tiempo_conectado).toBe(20 * 60);
    expect(overview(db, DAY, DAY, {}, NOW, [2]).totals.tiempo_conectado).toBe(10 * 60);
  });

  it("el listado de llamadas filtra por la selección", () => {
    const db = seeded();
    expect(listCalls(db, { from: DAY, to: DAY, agents: [1, 0] }, NOW).total).toBe(3);
    expect(listCalls(db, { from: DAY, to: DAY, agents: [2], resultado: "contestadas" }, NOW).total).toBe(1);
  });

  it("el selector lista primero a los activos, por nombre, y aparte a los que no llaman", () => {
    const opts = agentOptions(seeded(), NOW);
    expect(opts.map((a) => [a.id, a.active])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [0, true],
      [4, false],
    ]);
    expect(opts.find((a) => a.id === 4)?.lastCallMs).toBe(Date.parse("2026-05-01T07:00:00Z"));
  });
});
