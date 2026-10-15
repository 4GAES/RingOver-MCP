// Contrato de la API interna: lo comparten el servidor y el panel.
import type { Metrics } from "./metrics";

export interface AgentRef {
  id: number;
  name: string;
  initials: string;
  color: string | null;
  email: string | null;
}

/** Un comercial en el selector del panel. */
export interface AgentOption extends AgentRef {
  lastCallMs: number | null;
  /** Llamó en los últimos 60 días o está conectado ahora. */
  active: boolean;
}

export interface PeriodInfo {
  from: string;
  to: string;
  days: number;
  partial: boolean;
  startMs: number;
  endMs: number;
}

export interface CompareInfo extends PeriodInfo {
  label: string;
}

export interface SeriesPoint {
  /** Día (o lunes de la semana si la serie es semanal). */
  day: string;
  m: Metrics;
}

export interface LiveState {
  connected: boolean;
  inCall: boolean;
  snoozed: boolean;
  sinceMs: number;
  seenMs: number;
  fresh: boolean;
}

export interface AgentRow {
  agent: AgentRef;
  current: Metrics;
  previous: Metrics;
  live: LiveState | null;
}

export interface HourPoint {
  hour: number;
  nuevas: number;
  antiguas: number;
  contestadas: number;
}

export type Zone = "corta" | "media" | "larga";

export interface DurationBucket {
  /** Minuto inicial del tramo (30 = "30 min o más"). */
  minute: number;
  count: number;
  zone: Zone;
}

export type PresenceStatus = "ok" | "sin_permiso" | "error" | "pendiente";

export interface DataStatus {
  callsSyncedMs: number | null;
  presenceSyncedMs: number | null;
  presenceStatus: PresenceStatus;
  presenceSinceMs: number | null;
  historyFromMs: number | null;
  backfillRunning: boolean;
  lastError: string | null;
}

export interface Overview {
  period: PeriodInfo;
  compare: CompareInfo;
  totals: Metrics;
  previous: Metrics;
  series: { granularity: "day" | "week"; points: SeriesPoint[] };
  agents: AgentRow[];
  hours: HourPoint[];
  durations: DurationBucket[];
  status: DataStatus;
}

export interface TimelineCall {
  id: number;
  startMs: number;
  endMs: number;
  answered: boolean;
  isNew: boolean;
  talk: number;
  direction: "in" | "out";
  number: string | null;
  contactName: string | null;
}

export interface Timeline {
  day: string;
  startMs: number;
  endMs: number;
  segments: { startMs: number; endMs: number; snoozed: boolean }[];
  calls: TimelineCall[];
}

export interface AgentDetail extends Omit<Overview, "agents"> {
  agent: AgentRef;
  live: LiveState | null;
  timeline: Timeline | null;
}

export interface CallItem {
  id: number;
  startMs: number;
  agent: AgentRef | null;
  direction: "in" | "out";
  answered: boolean;
  state: string | null;
  talk: number;
  total: number;
  ring: number;
  number: string | null;
  contactName: string | null;
  isNew: boolean;
  record: string | null;
  tags: string[];
}

export interface CallsPage {
  items: CallItem[];
  next: string | null;
  total: number;
}

export interface NumberHistory {
  number: string;
  firstTalkMs: number | null;
  calls: CallItem[];
}

export interface LiveTeam {
  agents: { agent: AgentRef; live: LiveState; today: { llamadas: number; tiempo_llamada: number } }[];
  status: DataStatus;
}

/** Usuario tal como lo da 4Geeks Center. */
export interface CenterUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SessionUser extends CenterUser {
  /** Por dónde entró: cuenta de Center o Google (lista de usuarios de esta app). */
  provider: "center" | "google";
  /** Puede gestionar la lista de usuarios. */
  admin: boolean;
}

export interface UserItem {
  email: string;
  name: string | null;
  role: "admin" | "viewer";
  added_by: string | null;
  created_ms: number;
  last_login_ms: number | null;
  fixed: boolean;
}

// ── MCP: tokens, registro y consumo ──────────────────────────────────────────

export interface McpTokenItem {
  id: string;
  kind: "personal" | "oauth" | "config";
  name: string;
  prefix: string | null;
  owner: { email: string; name: string | null; provider: string };
  clientId: string | null;
  createdMs: number;
  expiresMs: number | null;
  lastUsedMs: number | null;
  lastClient: string | null;
  revokedMs: number | null;
  status: "activo" | "caducado" | "revocado";
  calls30d: number;
  callsToday: number;
}

export type McpCallStatus = "ok" | "error" | "denied" | "rate_limited";

export interface McpCallItem {
  id: number;
  tsMs: number;
  tokenId: string | null;
  tokenName: string | null;
  ownerEmail: string | null;
  client: string | null;
  method: string;
  tool: string | null;
  args: string | null;
  status: McpCallStatus;
  error: string | null;
  durationMs: number;
  bytes: number;
}

export interface McpUsage {
  from: string;
  to: string;
  totals: {
    calls: number;
    errors: number;
    blocked: number;
    avgMs: number;
    p95Ms: number;
    bytes: number;
    approxTokens: number;
    people: number;
    connections: number;
  };
  series: { day: string; ok: number; error: number }[];
  byTool: { tool: string; calls: number; errors: number; avgMs: number; approxTokens: number }[];
  byPerson: { email: string; calls: number; errors: number; approxTokens: number; lastMs: number }[];
  byClient: { client: string; calls: number }[];
  limits: { perMin: number; perDay: number };
}

export interface McpInfo {
  url: string;
  tools: { name: string; title: string; description: string; params: string[] }[];
  prompts: { name: string; title: string; description: string; params: string[] }[];
  resources: { uri: string; name: string; description: string }[];
  limits: { perMin: number; perDay: number };
}

export interface LeadItem {
  id: number;
  created_ms: number;
  nombre: string;
  email: string;
  empresa: string;
  comerciales: string;
  telefono: string | null;
  mensaje: string | null;
  email_sent: number;
  email_error: string | null;
}
