// Prueba de aceptación del MCP con el cliente oficial (el mismo que usan Claude y compañía).
// Uso: node --import tsx scripts/mcp-acceptance.ts --url https://ringover.duckdns.org/mcp --token-file .env.mcp
// Comprueba protocolo, las 15 herramientas, coherencia de datos entre ellas, validación de
// entradas, seguridad y latencia. Va a ritmo para no pasar del límite de 60 consultas/min.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { addDays, localDay, weekday } from "../src/shared/time";

export interface CheckResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface AcceptanceReport {
  results: CheckResult[];
  latency: { tool: string; ms: number; bytes: number }[];
  perf: { p50: number; p95: number; max: number; samples: number };
}

const EXPECTED_TOOLS = [
  "resumen",
  "evolucion",
  "comparar",
  "ranking",
  "llamadas",
  "historial_numero",
  "jornada",
  "estado_ahora",
  "comerciales",
  "definiciones",
  "alertas",
  "seguimientos_pendientes",
  "mejores_horas",
  "comparar_comerciales",
  "informe",
];

type Json = Record<string, unknown>;
type ToolOut = { isError: boolean; text: string; json: Json | null; ms: number; bytes: number };

class Pace {
  private stamps: number[] = [];
  constructor(private readonly perMinute: number) {}
  async wait() {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(now);
        return;
      }
      const first = this.stamps[0] ?? now;
      await new Promise((r) => setTimeout(r, 60_000 - (now - first) + 50));
    }
  }
}

export async function runAcceptance(opts: {
  url: string;
  token: string;
  perMinute?: number;
  log?: (line: string) => void;
}): Promise<AcceptanceReport> {
  const out: CheckResult[] = [];
  const latency: AcceptanceReport["latency"] = [];
  const pace = new Pace(opts.perMinute ?? 50);
  const say = opts.log ?? (() => undefined);
  const client = new Client({ name: "ringover-acceptance", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
  });
  await client.connect(transport);

  async function tool(name: string, args: Record<string, unknown> = {}): Promise<ToolOut> {
    await pace.wait();
    const t0 = performance.now();
    try {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { text?: string }[];
      };
      const text = r.content.map((c) => c.text ?? "").join("");
      let json: Json | null = null;
      try {
        json = JSON.parse(text) as Json;
      } catch {
        json = null;
      }
      return { isError: !!r.isError, text, json, ms: performance.now() - t0, bytes: Buffer.byteLength(text) };
    } catch (e) {
      // Errores de validación de entrada pueden llegar como error JSON-RPC.
      return {
        isError: true,
        text: e instanceof Error ? e.message : String(e),
        json: null,
        ms: performance.now() - t0,
        bytes: 0,
      };
    }
  }

  async function check(group: string, name: string, fn: () => Promise<string>) {
    const t0 = performance.now();
    try {
      const detail = await fn();
      out.push({ group, name, ok: true, detail, ms: performance.now() - t0 });
      say(`  ✓ ${name}${detail ? ` · ${detail}` : ""}`);
    } catch (e) {
      out.push({
        group,
        name,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        ms: performance.now() - t0,
      });
      say(`  ✗ ${name} · ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const expect = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg);
  };
  const eq = (a: unknown, b: unknown, what: string) =>
    expect(a === b, `${what}: ${String(a)} ≠ ${String(b)}`);
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tool(name, args);
    expect(!r.isError, `${name} devolvió error: ${r.text.slice(0, 160)}`);
    return r;
  };
  const num = (v: unknown) => Number(v ?? 0);
  type M = Record<string, number | string | null>;

  // Día de referencia: el último laborable cerrado (los datos ya no cambian).
  const today = localDay(Date.now());
  let D = addDays(today, -1);
  while (weekday(D) >= 5) D = addDays(D, -1);
  const W0 = addDays(D, -6);

  // ── 1. Protocolo ─────────────────────────────────────────────────────────
  say("Protocolo");
  await check("Protocolo", "Saludo inicial (initialize) e identidad del servidor", async () => {
    const v = client.getServerVersion();
    const caps = client.getServerCapabilities();
    expect(v?.name === "ringover-4geeks", `nombre: ${v?.name}`);
    expect(caps?.tools && caps.prompts && caps.resources, "faltan capacidades (tools/prompts/resources)");
    expect((client.getInstructions() ?? "").length > 150, "instrucciones del servidor demasiado cortas");
    return `${v?.name} ${v?.version}`;
  });
  let tools: {
    name: string;
    description?: string;
    inputSchema: { type: string };
    annotations?: { readOnlyHint?: boolean };
  }[] = [];
  await check("Protocolo", "Lista de herramientas completa y bien descrita", async () => {
    tools = (await client.listTools()).tools as typeof tools;
    const names = tools.map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
    expect(!missing.length, `faltan: ${missing.join(", ")}`);
    const poor = tools.filter((t) => (t.description ?? "").length < 40).map((t) => t.name);
    expect(!poor.length, `descripción pobre: ${poor.join(", ")}`);
    const notRo = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(!notRo.length, `sin readOnlyHint: ${notRo.join(", ")}`);
    expect(
      tools.every((t) => t.inputSchema?.type === "object"),
      "inputSchema no es objeto",
    );
    return `${tools.length} herramientas, todas de solo lectura`;
  });
  await check("Protocolo", "Prompts (comandos) y su contenido", async () => {
    const list = (await client.listPrompts()).prompts;
    expect(list.length === 5, `hay ${list.length} prompts`);
    for (const p of list) {
      const args: Record<string, string> =
        p.name === "revisar_comercial"
          ? { comercial: "test" }
          : p.name === "revisar_grupo"
            ? { comerciales: "test, otra" }
            : {};
      const g = await client.getPrompt({ name: p.name, arguments: args });
      const t = (g.messages[0]?.content as { text?: string })?.text ?? "";
      expect(t.includes("'"), `${p.name}: el prompt no nombra herramientas`);
    }
    return list.map((p) => `/${p.name}`).join(" ");
  });
  let agents: { id: number; nombre: string; email: string | null }[] = [];
  await check("Protocolo", "Recursos (definiciones y comerciales)", async () => {
    const list = (await client.listResources()).resources;
    expect(list.length === 2, `hay ${list.length} recursos`);
    const defs = await client.readResource({ uri: "ringover://definiciones" });
    expect(
      ((defs.contents[0] as { text?: string })?.text ?? "").includes("Llamadas nuevas"),
      "definiciones vacías",
    );
    const com = await client.readResource({ uri: "ringover://comerciales" });
    agents = JSON.parse((com.contents[0] as { text?: string })?.text ?? "[]");
    expect(agents.length > 0, "sin comerciales");
    return `${agents.length} comerciales`;
  });

  // ── 2. Todas las herramientas con valores por defecto ───────────────────
  say("Herramientas");
  let sampleNumber = "";
  let topAgent = "";
  const defaults: [string, Record<string, unknown>][] = [
    ["resumen", {}],
    ["evolucion", { desde: W0, hasta: D }],
    ["comparar", { a_desde: D, a_hasta: D }],
    ["ranking", { metrica: "llamadas", desde: D, hasta: D }],
    ["llamadas", { desde: D, hasta: D, limite: 5 }],
    ["estado_ahora", {}],
    ["comerciales", {}],
    ["definiciones", {}],
    ["alertas", {}],
    ["seguimientos_pendientes", { limite: 5 }],
    ["mejores_horas", {}],
    ["comparar_comerciales", { desde: D, hasta: D }],
    ["informe", { tipo: "diario", fecha: D }],
  ];
  for (const [name, args] of defaults) {
    await check("Herramientas", `${name}`, async () => {
      const r = await ok(name, args);
      latency.push({ tool: name, ms: r.ms, bytes: r.bytes });
      if (name !== "informe") expect(r.json, "la respuesta no es JSON");
      if (name === "llamadas") sampleNumber = String(((r.json?.llamadas as M[]) ?? [])[0]?.contacto ?? "");
      if (name === "ranking") topAgent = String(((r.json?.ranking as M[]) ?? [])[0]?.comercial ?? "");
      return `${Math.round(r.ms)} ms · ${(r.bytes / 1024).toFixed(1)} KB`;
    });
  }
  await check("Herramientas", "historial_numero", async () => {
    expect(sampleNumber, "no había número de ejemplo");
    const r = await ok("historial_numero", { numero: sampleNumber });
    latency.push({ tool: "historial_numero", ms: r.ms, bytes: r.bytes });
    expect(num(r.json?.total_llamadas) >= 1, "el número no tiene llamadas");
    return `${r.json?.total_llamadas} llamadas con ${sampleNumber}`;
  });
  await check("Herramientas", "jornada", async () => {
    expect(topAgent, "sin comercial de ejemplo");
    const r = await ok("jornada", { comercial: topAgent, fecha: D });
    latency.push({ tool: "jornada", ms: r.ms, bytes: r.bytes });
    return `${topAgent}: primera ${r.json?.primera_llamada}, última ${r.json?.ultima_llamada}`;
  });

  // ── 3. Coherencia de datos entre herramientas ────────────────────────────
  say(`Coherencia (día ${D} y semana ${W0}→${D})`);
  const day = (await ok("resumen", { desde: D, hasta: D })).json as Json;
  const team = day.equipo as M;
  const per = (day.por_comercial as { comercial: string; metricas: M }[]) ?? [];
  const named = per.filter((p) => p.comercial !== "Sin asignar");

  await check("Coherencia", "El equipo es la suma de los comerciales", async () => {
    for (const k of [
      "llamadas",
      "contestadas",
      "nuevas",
      "antiguas",
      "llamadas_mas_15_min",
      "llamadas_menos_5_min",
      "nuevas_mas_15_min",
      "tiempo_en_llamada_s",
    ]) {
      eq(
        per.reduce((a, p) => a + num(p.metricas[k]), 0),
        num(team[k]),
        k,
      );
    }
    return `${team.llamadas} llamadas en ${per.length} filas`;
  });
  await check("Coherencia", "Invariantes de las métricas (equipo y cada comercial)", async () => {
    for (const [who, m] of [
      ["equipo", team] as const,
      ...per.map((p) => [p.comercial, p.metricas] as const),
    ]) {
      eq(num(m.nuevas) + num(m.antiguas), num(m.llamadas), `${who} nuevas+antiguas`);
      eq(num(m.salientes) + num(m.entrantes), num(m.llamadas), `${who} salientes+entrantes`);
      expect(num(m.contestadas) <= num(m.llamadas), `${who} contestadas > llamadas`);
      expect(
        num(m.llamadas_mas_15_min) + num(m.llamadas_menos_5_min) <= num(m.contestadas),
        `${who} +15 y −5 suman más que las contestadas`,
      );
      expect(
        num(m.nuevas_mas_15_min) <= Math.min(num(m.nuevas), num(m.llamadas_mas_15_min)),
        `${who} nuevas +15 fuera de rango`,
      );
      expect(
        num(m.tiempo_en_llamada_s) <= num(m.tiempo_al_telefono_s) * 1.01 + 60,
        `${who} habla más tiempo del que pasa al teléfono`,
      );
    }
    return "nuevas+antiguas, salientes+entrantes, +15/−5 ≤ contestadas, hablado ≤ total";
  });
  await check("Coherencia", "ranking = resumen (por comercial)", async () => {
    const r = await ok("ranking", { metrica: "llamadas", desde: D, hasta: D });
    const rank = (r.json?.ranking as { comercial: string; valor: number }[]) ?? [];
    for (const p of named)
      eq(rank.find((x) => x.comercial === p.comercial)?.valor ?? 0, num(p.metricas.llamadas), p.comercial);
    const sorted = rank.every((x, i) => i === 0 || num(rank[i - 1]?.valor) >= num(x.valor));
    expect(sorted, "el ranking no está ordenado");
    return `${rank.length} comerciales, ordenado`;
  });
  await check("Coherencia", "llamadas (listado) cuenta lo mismo que resumen, con cada filtro", async () => {
    const total = async (a: Record<string, unknown>) =>
      num((await ok("llamadas", { desde: D, hasta: D, limite: 1, ...a })).json?.total_que_cumplen);
    eq(await total({}), num(team.llamadas), "todas");
    eq(await total({ tipo: "nuevas" }), num(team.nuevas), "nuevas");
    eq(await total({ resultado: "contestadas" }), num(team.contestadas), "contestadas");
    eq(await total({ duracion: "mas15" }), num(team.llamadas_mas_15_min), "+15 min");
    eq(await total({ duracion: "menos5" }), num(team.llamadas_menos_5_min), "−5 min");
    return "todas · nuevas · contestadas · +15 · −5";
  });
  await check("Coherencia", "evolucion por días suma lo mismo que la semana entera", async () => {
    const ev = ((await ok("evolucion", { desde: W0, hasta: D, agrupar: "dia" })).json?.serie as M[]) ?? [];
    const week = ((await ok("resumen", { desde: W0, hasta: D })).json?.equipo as M) ?? {};
    eq(ev.length, 7, "días en la serie");
    for (const k of ["llamadas", "nuevas", "contestadas", "llamadas_mas_15_min", "tiempo_en_llamada_s"])
      eq(
        ev.reduce((a, d) => a + num(d[k]), 0),
        num(week[k]),
        k,
      );
    eq(num(ev.at(-1)?.llamadas), num(team.llamadas), `día ${D}`);
    return `${week.llamadas} llamadas en la semana`;
  });
  await check("Coherencia", "comparar = resumen y su periodo anterior", async () => {
    const c = (await ok("comparar", { a_desde: D, a_hasta: D })).json as Json;
    const a = c.periodo_a as M;
    const b = c.periodo_b as M;
    const prev = (day.equipo_periodo_anterior as M) ?? {};
    eq(num(a.llamadas), num(team.llamadas), "periodo A");
    eq(num(b.llamadas), num(prev.llamadas), "periodo B");
    eq(String(b.desde), addDays(D, -7), "B es el mismo día de la semana pasada");
    return `A ${a.llamadas} · B ${b.llamadas}`;
  });
  await check("Coherencia", "comparar_comerciales = resumen", async () => {
    const cc = ((await ok("comparar_comerciales", { desde: D, hasta: D })).json?.comparativa as M[]) ?? [];
    for (const p of named.filter((x) => num(x.metricas.llamadas) > 0)) {
      eq(num(cc.find((x) => x.comercial === p.comercial)?.llamadas), num(p.metricas.llamadas), p.comercial);
    }
    return `${cc.length} comerciales`;
  });
  await check("Coherencia", "resumen filtrado por comercial = su fila del equipo", async () => {
    const p = named.find((x) => num(x.metricas.llamadas) > 0);
    expect(p, "nadie llamó ese día");
    const r = (await ok("resumen", { desde: D, hasta: D, comercial: p?.comercial })).json as Json;
    eq(num((r.metricas as M).llamadas), num(p?.metricas.llamadas), p?.comercial ?? "");
    const j = (await ok("jornada", { comercial: p?.comercial, fecha: D })).json as Json;
    eq(num((j.metricas as M).llamadas), num(p?.metricas.llamadas), "jornada");
    return `${p?.comercial}: ${p?.metricas.llamadas}`;
  });
  await check("Coherencia", "evolucion semanal y mensual cuadran con el total", async () => {
    const from = addDays(D, -41);
    const total = num((((await ok("resumen", { desde: from, hasta: D })).json?.equipo as M) ?? {}).llamadas);
    for (const agrupar of ["semana", "mes"]) {
      const serie = ((await ok("evolucion", { desde: from, hasta: D, agrupar })).json?.serie as M[]) ?? [];
      eq(
        serie.reduce((a, x) => a + num(x.llamadas), 0),
        total,
        `suma por ${agrupar}`,
      );
      eq(String(serie[0]?.desde), from, `${agrupar}: empieza el primer día`);
      eq(String(serie.at(-1)?.hasta), D, `${agrupar}: acaba el último día`);
    }
    return `${total} llamadas en 6 semanas, por semanas y por meses`;
  });
  await check("Coherencia", "Encuentra al comercial sin tildes, en minúsculas o por su email", async () => {
    const p = named.find((x) => num(x.metricas.llamadas) > 0);
    expect(p, "nadie llamó ese día");
    const plain = (p?.comercial ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const byPlain = (await ok("resumen", { desde: D, hasta: D, comercial: plain })).json as Json;
    eq(num((byPlain.metricas as M).llamadas), num(p?.metricas.llamadas), `"${plain}"`);
    const email = agents.find((a) => a.nombre === p?.comercial)?.email;
    if (email) {
      const byEmail = (await ok("resumen", { desde: D, hasta: D, comercial: email.split("@")[0] }))
        .json as Json;
      eq(String(byEmail.comercial), p?.comercial, "por email");
    }
    return `"${plain}"${email ? ` y "${email.split("@")[0]}"` : ""}`;
  });
  await check(
    "Coherencia",
    "Ranking por una métrica que puede no tener dato (tiempo conectado)",
    async () => {
      const r = await ok("ranking", { metrica: "tiempo_conectado", desde: D, hasta: D });
      return `${((r.json?.ranking as unknown[]) ?? []).length} filas sin errores`;
    },
  );
  await check("Coherencia", "Un listado grande no satura el contexto de la IA", async () => {
    const r = await ok("llamadas", { desde: W0, hasta: D, limite: 200 });
    expect(num(r.json?.mostradas) <= 200, "devuelve más de 200");
    expect(r.bytes < 120 * 1024, `demasiado grande: ${(r.bytes / 1024).toFixed(0)} KB`);
    return `${r.json?.mostradas} llamadas en ${(r.bytes / 1024).toFixed(0)} KB (≈ ${Math.round(r.bytes / 4 / 1000)} mil tokens)`;
  });
  await check("Coherencia", "Atajos de periodo = las mismas fechas escritas a mano", async () => {
    const pairs: [string, string, string][] = [
      ["ayer", addDays(today, -1), addDays(today, -1)],
      [
        "semana_pasada",
        addDays(addDays(today, -weekday(today)), -7),
        addDays(addDays(today, -weekday(today)), -1),
      ],
      [
        "mes_pasado",
        `${addDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`,
        addDays(`${today.slice(0, 8)}01`, -1),
      ],
    ];
    for (const [p, from, to] of pairs) {
      const a = (await ok("resumen", { periodo: p })).json as Json;
      const b = (await ok("resumen", { desde: from, hasta: to })).json as Json;
      eq(num((a.equipo as M).llamadas), num((b.equipo as M).llamadas), p);
      eq(String((a.periodo as M).from), from, `${p} empieza`);
    }
    return "ayer · semana_pasada · mes_pasado";
  });
  await check("Coherencia", "Hoy (en curso) se compara igual en comparar que en resumen", async () => {
    const r = (await ok("resumen", { periodo: "hoy" })).json as Json;
    const c = (await ok("comparar", { periodo_a: "hoy" })).json as Json;
    eq(
      num((c.periodo_b as M).llamadas),
      num((r.equipo_periodo_anterior as M).llamadas),
      "periodo anterior hasta la misma hora",
    );
    return `hoy ${(c.periodo_a as M).llamadas} vs ${(c.periodo_b as M).llamadas} (${(c.periodo_b as M).explicacion})`;
  });
  await check("Coherencia", "El servidor le dice a la IA qué día es hoy", async () => {
    expect((client.getInstructions() ?? "").includes(today), "las instrucciones no llevan la fecha de hoy");
    return `"Hoy es … ${today}"`;
  });
  await check("Coherencia", "informe diario usa las mismas cifras", async () => {
    const md = (await ok("informe", { tipo: "diario", fecha: D })).text;
    expect(md.includes(`**${team.llamadas} llamadas**`), "la cifra de llamadas no coincide");
    expect(md.includes("| Comercial |"), "falta la tabla por comercial");
    return `${md.split("\n").length} líneas`;
  });

  // Grupos de comerciales (parámetro 'comerciales'): todo se limita al grupo y cuadra.
  const pair = named.filter((x) => num(x.metricas.llamadas) > 0).slice(0, 2);
  const groupNames = pair.map((x) => x.comercial);
  const groupSum = (k: string) => pair.reduce((a, x) => a + num(x.metricas[k]), 0);
  await check("Grupos", "resumen de un grupo = suma de sus comerciales", async () => {
    expect(pair.length === 2, "no hay dos comerciales con llamadas ese día");
    const g = (await ok("resumen", { desde: D, hasta: D, comerciales: groupNames })).json as Json;
    const tot = g.grupo_total as M;
    for (const k of ["llamadas", "nuevas", "contestadas", "llamadas_mas_15_min", "tiempo_en_llamada_s"])
      eq(num(tot[k]), groupSum(k), k);
    const rows = (g.por_comercial as { comercial: string }[]) ?? [];
    eq(rows.length, 2, "filas del grupo");
    expect((g.grupo as string[]).length === 2, "no dice quién forma el grupo");
    return `${groupNames.join(" + ")}: ${tot.llamadas} llamadas`;
  });
  await check("Grupos", "listado, evolución, comparar y ranking del grupo cuadran", async () => {
    const list = (await ok("llamadas", { desde: D, hasta: D, limite: 1, comerciales: groupNames })).json;
    eq(num(list?.total_que_cumplen), groupSum("llamadas"), "llamadas");
    const ev =
      ((await ok("evolucion", { desde: D, hasta: D, comerciales: groupNames })).json?.serie as M[]) ?? [];
    eq(num(ev[0]?.llamadas), groupSum("llamadas"), "evolucion");
    const c = (await ok("comparar", { a_desde: D, a_hasta: D, comerciales: groupNames })).json as Json;
    eq(num((c.periodo_a as M).llamadas), groupSum("llamadas"), "comparar");
    const rk = (await ok("ranking", { metrica: "llamadas", desde: D, hasta: D, comerciales: groupNames }))
      .json?.ranking as M[];
    eq(rk.length, 2, "ranking del grupo");
    return "llamadas · evolucion · comparar · ranking";
  });
  await check("Grupos", "seguimientos, horas, alertas, estado e informe aceptan un grupo", async () => {
    for (const [name, args] of [
      ["seguimientos_pendientes", { comerciales: groupNames, limite: 5 }],
      ["mejores_horas", { comerciales: groupNames }],
      ["alertas", { fecha: D, comerciales: groupNames }],
      ["estado_ahora", { comerciales: groupNames }],
    ] as const)
      await ok(name, args);
    const md = (await ok("informe", { tipo: "diario", fecha: D, comerciales: groupNames })).text;
    expect(md.includes("**Grupo:**"), "el informe no dice de qué grupo es");
    expect(md.includes(`**${groupSum("llamadas")} llamadas**`), "el informe no usa las cifras del grupo");
    return "5 herramientas";
  });

  // ── 4. Validación de entradas: errores claros, nunca caídas ──────────────
  say("Validación de entradas");
  const mustFail = async (name: string, args: Record<string, unknown>, expectText?: RegExp) => {
    const r = await tool(name, args);
    expect(r.isError, `debería fallar y respondió: ${r.text.slice(0, 80)}`);
    if (expectText) expect(expectText.test(r.text), `mensaje poco claro: ${r.text.slice(0, 120)}`);
    return r.text.replace(/\s+/g, " ").slice(0, 70);
  };
  await check("Validación", "Fecha imposible (2026-02-30)", () =>
    mustFail("resumen", { desde: "2026-02-30" }, /inexistente/i),
  );
  await check("Validación", "Mes imposible (2026-13-01)", () =>
    mustFail("resumen", { desde: "2026-13-01" }, /inexistente/i),
  );
  await check("Validación", "Fecha en el futuro", () =>
    mustFail("resumen", { desde: addDays(today, 30) }, /futuro/i),
  );
  await check("Validación", "Desde posterior a hasta", () =>
    mustFail("resumen", { desde: D, hasta: W0 }, /posterior/i),
  );
  await check("Validación", "Rango de más de 400 días", () =>
    mustFail("evolucion", { desde: addDays(D, -500), hasta: D }, /400/),
  );
  await check("Validación", "Comercial que no existe", () =>
    mustFail("resumen", { comercial: "Nadie Inventado" }, /No encuentro/),
  );
  await check("Validación", "Un nombre que no existe en un grupo → error que lo nombra", () =>
    mustFail("resumen", { comerciales: [groupNames[0] ?? "x", "Nadie Inventado"] }, /Nadie Inventado/),
  );
  await check("Validación", "Métrica inexistente en ranking", () =>
    mustFail("ranking", { metrica: "ventas" }),
  );
  await check("Validación", "Límite fuera de rango", () => mustFail("llamadas", { limite: 5000 }));
  await check("Validación", "Agrupación inválida", () =>
    mustFail("evolucion", { desde: W0, hasta: D, agrupar: "anual" }),
  );
  await check("Validación", "Número sin llamadas: respuesta limpia", async () => {
    const r = await ok("historial_numero", { numero: "+34 699 919 293" });
    return String(r.json?.mensaje ?? r.json?.total_llamadas);
  });

  // ── 5. Seguridad (HTTP directo) ──────────────────────────────────────────
  say("Seguridad");
  const post = (headers: Record<string, string>, body: string, url = opts.url) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body,
    });
  const listBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await check("Seguridad", "Sin token → 401 con dónde autorizar (OAuth)", async () => {
    const r = await post({}, listBody);
    eq(r.status, 401, "estado");
    expect(
      (r.headers.get("www-authenticate") ?? "").includes("resource_metadata="),
      "falta resource_metadata en WWW-Authenticate",
    );
    return "WWW-Authenticate con resource_metadata";
  });
  await check("Seguridad", "Token inventado → 401", async () => {
    eq((await post({ Authorization: "Bearer rgo_p_inventado" }, listBody)).status, 401, "estado");
    return "rechazado";
  });
  await check("Seguridad", "Token en la URL (?token=) no se acepta", async () => {
    eq(
      (await post({}, listBody, `${opts.url}?token=${encodeURIComponent(opts.token)}`)).status,
      401,
      "estado",
    );
    return "solo vale la cabecera Authorization";
  });
  await check("Seguridad", "Esquema 'bearer' en minúsculas (RFC 6750) funciona", async () => {
    await pace.wait();
    eq((await post({ Authorization: `bearer ${opts.token}` }, listBody)).status, 200, "estado");
    return "aceptado";
  });
  await check("Seguridad", "JSON roto → error de protocolo, no caída", async () => {
    await pace.wait();
    const r = await post({ Authorization: `Bearer ${opts.token}` }, "{no es json");
    expect(r.status >= 400 && r.status < 500, `estado ${r.status}`);
    return `HTTP ${r.status}`;
  });
  await check("Seguridad", "Preflight CORS para clientes web", async () => {
    const r = await fetch(opts.url, {
      method: "OPTIONS",
      headers: { Origin: "https://claude.ai", "Access-Control-Request-Method": "POST" },
    });
    eq(r.status, 204, "estado");
    eq(r.headers.get("access-control-allow-origin"), "*", "origen");
    return "204 · Allow-Origin *";
  });
  await check("Seguridad", "Descubrimiento OAuth publicado", async () => {
    const base = new URL(opts.url).origin;
    const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as {
      resource?: string;
    };
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as {
      code_challenge_methods_supported?: string[];
    };
    eq(prm.resource, opts.url, "resource");
    expect(as.code_challenge_methods_supported?.includes("S256"), "sin PKCE S256");
    return "RFC 9728 + RFC 8414, PKCE S256";
  });

  // ── 6. Rendimiento ───────────────────────────────────────────────────────
  say("Rendimiento");
  const samples: number[] = [];
  await check("Rendimiento", "12 resúmenes seguidos", async () => {
    for (let i = 0; i < 12; i++) samples.push((await ok("resumen", {})).ms);
    return `mediana ${Math.round([...samples].sort((a, b) => a - b)[6] ?? 0)} ms`;
  });
  await check("Rendimiento", "5 consultas en paralelo", async () => {
    await pace.wait();
    await pace.wait();
    await pace.wait();
    await pace.wait();
    const t0 = performance.now();
    const rs = await Promise.all(
      ["resumen", "alertas", "seguimientos_pendientes", "mejores_horas", "estado_ahora"].map((n) =>
        client.callTool({ name: n, arguments: {} }),
      ),
    );
    expect(
      rs.every((r) => !r.isError),
      "alguna falló",
    );
    return `todas bien en ${Math.round(performance.now() - t0)} ms`;
  });
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number) =>
    Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0);

  await client.close();
  return {
    results: out,
    latency,
    perf: { p50: pct(0.5), p95: pct(0.95), max: Math.round(sorted.at(-1) ?? 0), samples: sorted.length },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const arg = (n: string) =>
    process.argv
      .find((a) => a.startsWith(`--${n}=`))
      ?.split("=")
      .slice(1)
      .join("=") ?? process.argv[process.argv.indexOf(`--${n}`) + 1];
  const url = arg("url") ?? "https://ringover.duckdns.org/mcp";
  const tokenFile = arg("token-file");
  const token = (tokenFile ? readFileSync(tokenFile, "utf8") : (process.env.MCP_TEST_TOKEN ?? "")).trim();
  const t0 = Date.now();
  runAcceptance({ url, token, log: (l) => console.log(l) })
    .then((r) => {
      const failed = r.results.filter((x) => !x.ok);
      console.log(
        `\nLatencia de 'resumen': p50 ${r.perf.p50} ms · p95 ${r.perf.p95} ms · máx ${r.perf.max} ms (${r.perf.samples} muestras)`,
      );
      console.log(
        `Resultado: ${r.results.length - failed.length}/${r.results.length} comprobaciones correctas en ${Math.round((Date.now() - t0) / 1000)} s`,
      );
      process.exit(failed.length ? 1 : 0);
    })
    .catch((e) => {
      console.error("La prueba no pudo completarse:", e);
      process.exit(2);
    });
}
