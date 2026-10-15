import { describe, expect, it } from "vitest";
import { alerts, bestHours, pendingFollowUps } from "../../src/server/queries/insights";
import { recomputeNewness, saveCalls } from "../../src/server/sync/calls";
import { addDays, DAY_MS, localToUtc } from "../../src/shared/time";
import { call, memDb } from "./helpers";

const DAY = "2026-10-01"; // jueves
const iso = (day: string, h: number, m = 0) => new Date(localToUtc(day, h * 3600 + m * 60)).toISOString();

describe("señales del día", () => {
  it("avisa cuando alguien va muy por debajo de su propia media", () => {
    const db = memDb();
    const calls = [];
    for (const k of [7, 14, 21, 28]) {
      for (let i = 0; i < 20; i++) {
        calls.push(
          call({
            start: iso(addDays(DAY, -k), 10, i * 2),
            talk: 120,
            contact_number: `3460000${k}${String(i).padStart(2, "0")}`,
          }),
        );
      }
    }
    calls.push(call({ start: iso(DAY, 10), talk: 60, contact_number: "34611111111" }));
    calls.push(call({ start: iso(DAY, 11), talk: 60, contact_number: "34611111112" }));
    saveCalls(db, calls);
    recomputeNewness(db);
    const r = alerts(db, DAY, localToUtc(addDays(DAY, 1), 3600));
    expect(r.referencia).toBe("media de los 4 jueves anteriores");
    expect(r.alertas[0]).toMatchObject({ nivel: "alta", señal: "Menos llamadas de lo habitual" });
  });
});

describe("seguimientos pendientes", () => {
  it("lista primeras conversaciones buenas sin ninguna llamada después", () => {
    const db = memDb();
    const now = localToUtc(DAY, 12 * 3600);
    const t = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString();
    saveCalls(db, [
      call({ start: t(5), talk: 900, contact_number: "34622000001" }), // caliente y olvidado → sale
      call({ start: t(6), talk: 700, contact_number: "34622000002" }),
      call({ start: t(2), talk: 30, contact_number: "34622000002" }), // ya se le volvió a llamar → no sale
      call({ start: t(5), talk: 60, contact_number: "34622000003" }), // conversación corta → no sale
      call({ start: t(1), talk: 900, contact_number: "34622000004" }), // demasiado reciente → no sale
    ]);
    recomputeNewness(db);
    const r = pendingFollowUps(db, { minSeconds: 300, daysWithout: 3 }, now);
    expect(r.total).toBe(1);
    expect(r.seguimientos[0]).toMatchObject({
      numero: "+34 622 00 00 01",
      duracion: "15 min",
      dias_sin_llamar: 5,
    });
  });
});

describe("mejores horas", () => {
  it("calcula la tasa de contacto por hora con las llamadas salientes", () => {
    const db = memDb();
    const calls = [];
    for (let i = 0; i < 12; i++)
      calls.push(call({ start: iso(DAY, 10, i * 3), talk: i < 9 ? 90 : 0, contact_number: `3463000${i}01` }));
    for (let i = 0; i < 12; i++)
      calls.push(call({ start: iso(DAY, 16, i * 3), talk: i < 3 ? 90 : 0, contact_number: `3463000${i}02` }));
    saveCalls(db, calls);
    const r = bestHours(db, DAY, DAY, undefined, localToUtc(addDays(DAY, 1)));
    expect(r.mejores_franjas[0]).toMatchObject({ dia: "jueves", hora: "10:00" });
    // El formato español separa el % con un espacio duro (U+00A0).
    expect(r.mejores_franjas[0]?.tasa_contacto.replace(/\s/g, " ")).toBe("75 %");
    expect(r.por_hora.map((h) => h.hora)).toEqual(["10:00", "16:00"]);
  });
});
