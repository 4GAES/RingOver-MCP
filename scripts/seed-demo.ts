// Datos de demostración realistas para desarrollar el panel y para los tests E2E.
// Uso: DB_PATH=./data/demo.db node --import tsx scripts/seed-demo.ts [--days=120] [--now=2026-10-02T14:20:00Z]
import { rmSync } from "node:fs";
import { ApiTokens } from "../src/server/auth/tokens";
import { Users } from "../src/server/auth/users";
import { openDb, setState, tx } from "../src/server/db";
import { McpLog } from "../src/server/mcp/log";
import type { RingoverCall } from "../src/server/ringover/schemas";
import { recomputeNewness, saveCalls } from "../src/server/sync/calls";
import { DAY_MS, localDay, localToUtc, weekday } from "../src/shared/time";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const DB_PATH = process.env.DB_PATH ?? "./data/demo.db";
const DAYS = Number(arg("days") ?? 120);
const NOW = arg("now") ? Date.parse(arg("now") as string) : Date.now();

// PRNG determinista: los tests E2E necesitan los mismos datos en cada ejecución.
let seed = 20261002;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)] as T;
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

const AGENTS = [
  {
    user_id: 101,
    firstname: "Lucía",
    lastname: "Martín",
    email: "lucia@demo.test",
    color: "#2a78d6",
    pace: 1.15,
    depth: 0.9,
  },
  {
    user_id: 102,
    firstname: "Diego",
    lastname: "Romero",
    email: "diego@demo.test",
    color: "#eb6834",
    pace: 1.0,
    depth: 1.0,
  },
  {
    user_id: 103,
    firstname: "Carla",
    lastname: "Vidal",
    email: "carla@demo.test",
    color: "#1baf7a",
    pace: 0.7,
    depth: 1.45,
  },
  {
    user_id: 104,
    firstname: "Marcos",
    lastname: "Pardo",
    email: "marcos@demo.test",
    color: "#4a3aa7",
    pace: 0.85,
    depth: 1.1,
  },
];

const leads: string[] = [];
const newLead = () => {
  const intl = rnd() < 0.18;
  const n = intl
    ? `${pick(["52", "57", "56", "54", "51"])}${String(Math.floor(1e9 + rnd() * 8e9))}`
    : `34${pick(["6", "7"])}${String(Math.floor(1e7 + rnd() * 8.9e7)).padStart(8, "0")}`;
  leads.push(n);
  return n;
};

/** Conversación: mayoría corta, cola larga (como el equipo real). */
const talkSeconds = (depth: number) => {
  const r = rnd();
  if (r < 0.52) return Math.round(15 + rnd() * 120);
  if (r < 0.8) return Math.round(120 + rnd() * 300 * depth);
  if (r < 0.93) return Math.round(300 + rnd() * 600 * depth);
  return Math.round(900 + Math.abs(gauss()) * 700 * depth);
};

rmSync(DB_PATH, { force: true });
rmSync(`${DB_PATH}-wal`, { force: true });
rmSync(`${DB_PATH}-shm`, { force: true });
const db = openDb(DB_PATH);

const calls: RingoverCall[] = [];
let cdr = 9_000_000;
const today = localDay(NOW);
for (let i = DAYS - 1; i >= 0; i--) {
  const day = localDay(NOW - i * DAY_MS);
  const wd = weekday(day);
  if (wd === 6) continue;
  const weekendFactor = wd === 5 ? 0.06 : 1;
  for (const a of AGENTS) {
    if (rnd() < 0.04) continue; // día libre
    let t = localToUtc(day, (9 + rnd() * 0.6) * 3600);
    const end = localToUtc(day, (19 + rnd() * 1.5) * 3600);
    const target = Math.round((34 + gauss() * 6) * a.pace * weekendFactor);
    for (let k = 0; k < target && t < end; k++) {
      if (day === today && t > NOW) break;
      const lunch = localToUtc(day, 14 * 3600);
      if (t > lunch && t < lunch + 3600 && rnd() < 0.85) t = lunch + 3600 + rnd() * 600_000;
      const isFollowUp = leads.length > 30 && rnd() < 0.45;
      const number = isFollowUp ? (pick(leads.slice(-400)) as string) : newLead();
      const inbound = rnd() < 0.05;
      const answered = rnd() < (isFollowUp ? 0.7 : 0.55);
      const ring = 4 + rnd() * 22;
      const talk = answered ? talkSeconds(a.depth) : 0;
      const total = Math.round(ring + talk + (answered ? 2 : 0));
      const start = t;
      const state = answered
        ? "ANSWERED"
        : inbound
          ? "MISSED"
          : pick(["CANCELLED", "CANCELLED", "FAILED", "UNANSWERED"]);
      calls.push({
        cdr_id: cdr++,
        call_id: `demo-${cdr}`,
        type: "PHONE",
        direction: inbound ? "in" : "out",
        is_answered: answered,
        last_state: state,
        start_time: new Date(start).toISOString(),
        answered_time: answered ? new Date(start + ring * 1000).toISOString() : null,
        end_time: new Date(start + total * 1000).toISOString(),
        incall_duration: answered ? talk : null,
        total_duration: total,
        ringing_duration: ring,
        hold_duration: 0,
        queue_duration: 0,
        hangup_by: pick(["CALLER", "CALLEE"]),
        contact_number: number,
        from_number: inbound ? number : "34910000000",
        to_number: inbound ? "34910000000" : number,
        record: null,
        tags: null,
        contact: null,
        user: {
          user_id: a.user_id,
          firstname: a.firstname,
          lastname: a.lastname,
          concat_name: `${a.firstname} ${a.lastname}`,
          email: a.email,
          initial: `${a.firstname[0]}${a.lastname[0]}`,
          color: a.color,
          picture: null,
        },
      });
      t = start + total * 1000 + (40 + rnd() * 420 + (rnd() < 0.08 ? 1800 : 0)) * 1000;
    }
  }
}
saveCalls(db, calls, NOW);
recomputeNewness(db);

// Conexión medida solo los últimos 10 días (como en producción, empieza el día que arranca la app).
const presenceDays = 10;
const presenceSince = localToUtc(localDay(NOW - presenceDays * DAY_MS), 8 * 3600);
tx(db, () => {
  const ins = db.prepare(
    "INSERT INTO presence_segments (user_id, start_ms, end_ms, snoozed, open) VALUES (?, ?, ?, ?, ?)",
  );
  for (let i = presenceDays; i >= 0; i--) {
    const day = localDay(NOW - i * DAY_MS);
    if (weekday(day) >= 5) continue;
    for (const a of AGENTS) {
      let s = localToUtc(day, (8.7 + rnd() * 0.5) * 3600);
      const dayEnd = localToUtc(day, (19.2 + rnd() * 1.2) * 3600);
      while (s < dayEnd && s < NOW) {
        const len = (60 + rnd() * 140) * 60_000;
        const e = Math.min(s + len, dayEnd, NOW);
        const isOpen = e >= NOW - 60_000 ? 1 : 0;
        ins.run(a.user_id, s, e - 60_000, rnd() < 0.08 ? 1 : 0, isOpen);
        s = e + (rnd() < 0.5 ? 45 : 8) * 60_000;
      }
    }
  }
  const nowIns = db.prepare(
    "INSERT INTO presence_now (user_id, connected, in_call, snoozed, devices, seen_ms, state_since_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const states = [
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 0],
  ];
  AGENTS.forEach((a, i) => {
    const [c, inCall, sn] = states[i] as [number, number, number];
    nowIns.run(a.user_id, c, inCall, sn, c, NOW - 20_000, NOW - (3 + i * 11) * 60_000);
  });
});
setState(db, "presence_since_ms", presenceSince);
setState(db, "presence_synced_ms", NOW - 20_000);
setState(db, "presence_status", "ok");
setState(db, "calls_synced_ms", NOW - 90_000);
setState(db, "history_from_ms", Math.min(...calls.map((c) => Date.parse(c.start_time))));
setState(db, "backfill_done", "1");
// Actividad de demo del MCP: un token personal, una conexión de Claude y un mes de uso.
const users = new Users(db, "nacho@4geeksacademy.com");
users.add("ana@4geeksacademy.com", "viewer", "nacho@4geeksacademy.com", NOW - 20 * DAY_MS);
const tokens = new ApiTokens(db, users, "");
const nacho = { email: "nacho@4geeksacademy.com", name: "Nacho", provider: "google" as const, role: "admin" };
const ana = { email: "ana@4geeksacademy.com", name: "Ana", provider: "google" as const, role: "viewer" };
const t1 = tokens.createPersonal(nacho, "Claude Code del portátil", 90, NOW - 25 * DAY_MS).id;
const t2 = tokens.createGrant(nacho, "mcp_demo", "Claude", NOW - 18 * DAY_MS).grantId;
const t3 = tokens.createGrant(ana, "mcp_demo2", "ChatGPT", NOW - 9 * DAY_MS).grantId;
const mcpLog = new McpLog(db, { perMin: 60, perDay: 2000 });
const TOOLS: [string, number, number][] = [
  ["resumen", 0.3, 2400],
  ["alertas", 0.14, 1800],
  ["seguimientos_pendientes", 0.12, 3200],
  ["informe", 0.08, 4200],
  ["comparar_comerciales", 0.08, 2100],
  ["llamadas", 0.1, 5200],
  ["mejores_horas", 0.06, 2600],
  ["jornada", 0.06, 1500],
  ["estado_ahora", 0.06, 700],
];
const pickTool = () => {
  let r = rnd();
  for (const t of TOOLS) {
    r -= t[1];
    if (r <= 0) return t;
  }
  return TOOLS[0] as [string, number, number];
};
const who = [
  { id: t1, email: nacho.email, client: "claude-code 2.1.0" },
  { id: t2, email: nacho.email, client: "claude-ai 0.1.0" },
  { id: t3, email: ana.email, client: "openai-mcp 1.0.0" },
];
tx(db, () => {
  for (let d = 29; d >= 0; d--) {
    const day = localDay(NOW - d * DAY_MS);
    if (weekday(day) >= 5) continue;
    const n = 4 + Math.floor(rnd() * 14);
    for (let i = 0; i < n; i++) {
      const w = who[d < 9 ? Math.floor(rnd() * 3) : Math.floor(rnd() * 2)] as (typeof who)[number];
      const ts = Math.min(localToUtc(day, (9 + rnd() * 10) * 3600), NOW - 60_000);
      const [tool, , size] = pickTool();
      const err = rnd() < 0.03;
      mcpLog.record({
        tsMs: ts,
        tokenId: w.id,
        ownerEmail: w.email,
        client: w.client,
        method: "tools/call",
        tool,
        args:
          tool === "resumen"
            ? { desde: day }
            : tool === "seguimientos_pendientes"
              ? { dias_sin_llamar: 3 }
              : {},
        status: err ? "error" : "ok",
        error: err
          ? "No encuentro al comercial \"Pablo H\". Usa la herramienta 'comerciales' para ver la lista."
          : null,
        durationMs: 8 + rnd() * 70 + (tool === "informe" ? 120 : 0),
        bytes: Math.round(size * (0.6 + rnd() * 0.9)),
      });
    }
  }
  mcpLog.record({
    tsMs: NOW - 3 * DAY_MS,
    tokenId: t1,
    ownerEmail: nacho.email,
    client: "curl/8.7",
    method: "auth",
    status: "denied",
    error: "Token caducado",
  });
});
tokens.touch(t1, "127.0.0.1", "claude-code 2.1.0", NOW - 3600_000);
tokens.touch(t2, "127.0.0.1", "claude-ai 0.1.0", NOW - 600_000);
tokens.touch(t3, "127.0.0.1", "openai-mcp 1.0.0", NOW - DAY_MS);

db.close();
console.log(`Demo: ${calls.length} llamadas, ${AGENTS.length} comerciales → ${DB_PATH}`);
