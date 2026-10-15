import { describe, expect, it } from "vitest";
import { periodRange } from "../../src/server/mcp/server";

describe("atajos de periodo del MCP", () => {
  const now = Date.parse("2026-10-02T10:00:00Z"); // viernes 2 de octubre (Madrid)
  it.each([
    ["hoy", ["2026-10-02", "2026-10-02"]],
    ["ayer", ["2026-10-01", "2026-10-01"]],
    ["esta_semana", ["2026-09-28", "2026-10-02"]],
    ["semana_pasada", ["2026-09-21", "2026-09-27"]],
    ["este_mes", ["2026-10-01", "2026-10-02"]],
    ["mes_pasado", ["2026-09-01", "2026-09-30"]],
    ["ultimos_7_dias", ["2026-09-26", "2026-10-02"]],
    ["ultimos_30_dias", ["2026-09-03", "2026-10-02"]],
  ] as const)("%s", (p, expected) => {
    expect(periodRange(p, now)).toEqual(expected);
  });

  it("el mes pasado de marzo es febrero entero (también en bisiesto)", () => {
    expect(periodRange("mes_pasado", Date.parse("2028-03-10T10:00:00Z"))).toEqual([
      "2028-02-01",
      "2028-02-29",
    ]);
  });

  it("un lunes, 'esta semana' es solo ese día", () => {
    expect(periodRange("esta_semana", Date.parse("2026-09-28T10:00:00Z"))).toEqual([
      "2026-09-28",
      "2026-09-28",
    ]);
  });
});
