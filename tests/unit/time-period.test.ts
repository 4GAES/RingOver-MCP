import { describe, expect, it } from "vitest";
import { comparePeriod, PeriodError, resolvePeriod } from "../../src/server/queries/period";
import { addMonths, localDay, localHour, localToUtc } from "../../src/shared/time";

describe("hora de Madrid", () => {
  it("convierte días locales a UTC en verano e invierno", () => {
    expect(new Date(localToUtc("2026-07-15")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(new Date(localToUtc("2026-01-15")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("respeta los cambios de hora (último domingo de octubre)", () => {
    // 25 oct 2026: a las 3:00 vuelven a ser las 2:00 → el día dura 25 horas.
    const start = localToUtc("2026-10-25");
    const end = localToUtc("2026-10-26");
    expect((end - start) / 3600_000).toBe(25);
  });

  it("asigna al día local las llamadas de madrugada UTC", () => {
    const ms = Date.parse("2026-10-01T22:30:00Z"); // 00:30 del 2 oct en Madrid
    expect(localDay(ms)).toBe("2026-10-02");
    expect(localHour(ms)).toBe(0);
  });

  it("resta meses recortando al último día", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-10-02", -1)).toBe("2026-09-02");
  });
});

describe("periodos y comparación", () => {
  const now = Date.parse("2026-10-02T12:20:00Z"); // jueves 14:20 en Madrid

  it("hoy se compara con el mismo día de la semana pasada hasta la misma hora", () => {
    const p = resolvePeriod("2026-10-02", "2026-10-02", now);
    expect(p.partial).toBe(true);
    expect(p.endMs).toBe(now);
    const c = comparePeriod(p, now);
    expect(c.from).toBe("2026-09-25");
    expect(new Date(c.endMs).toISOString()).toBe("2026-09-25T12:20:00.000Z");
  });

  it("un día cerrado se compara entero", () => {
    const c = comparePeriod(resolvePeriod("2026-09-30", "2026-09-30", now), now);
    expect(c.from).toBe("2026-09-23");
    expect(c.endMs).toBe(localToUtc("2026-09-24"));
  });

  it("el mes en curso se compara con el mismo tramo del mes anterior", () => {
    const c = comparePeriod(resolvePeriod("2026-10-01", "2026-10-02", now), now);
    expect([c.from, c.to]).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("una semana de lunes a domingo se compara con la anterior", () => {
    const c = comparePeriod(resolvePeriod("2026-09-21", "2026-09-27", now), now);
    expect([c.from, c.to, c.label]).toEqual(["2026-09-14", "2026-09-20", "semana anterior"]);
  });

  it("rechaza fechas que no existen en el calendario", () => {
    expect(() => resolvePeriod("2026-02-30", "2026-02-30", now)).toThrow(/inexistente/);
    expect(() => resolvePeriod("2026-13-01", "2026-13-01", now)).toThrow(/inexistente/);
    expect(resolvePeriod("2024-02-29", "2024-02-29", now).days).toBe(1); // bisiesto: sí existe
  });

  it("recorta el final al día de hoy y rechaza fechas futuras", () => {
    expect(resolvePeriod("2026-09-28", "2026-10-10", now).to).toBe("2026-10-02");
    expect(() => resolvePeriod("2026-10-05", "2026-10-06", now)).toThrow(PeriodError);
    expect(() => resolvePeriod("2026-10-02", "2026-10-01", now)).toThrow(PeriodError);
  });
});
