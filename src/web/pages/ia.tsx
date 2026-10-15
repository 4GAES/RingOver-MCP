import { useEffect, useState } from "react";
import type { McpCallItem, McpTokenItem, SessionUser } from "../../shared/api";
import { fmtDayShort, fmtInt, fmtPct } from "../../shared/format";
import { localDay } from "../../shared/time";
import { Columns } from "../components/charts";
import { IconAlert, IconX } from "../components/icons";
import { TipRow } from "../components/tooltip";
import { Empty, Skeleton } from "../components/ui";
import {
  useAgentOptions,
  useCreateToken,
  useMcpInfo,
  useMcpLog,
  useMcpTokens,
  useMcpUsage,
  useRevokeToken,
} from "../lib/api";
import { relativeTime, useNow } from "../lib/hooks";
import { setParams, useLocation } from "../lib/router";

type Tab = "conectar" | "tokens" | "actividad" | "consumo";
const TABS: { key: Tab; label: string }[] = [
  { key: "conectar", label: "Conectar" },
  { key: "tokens", label: "Tokens" },
  { key: "actividad", label: "Actividad" },
  { key: "consumo", label: "Consumo" },
];

// ── Piezas comunes ───────────────────────────────────────────────────────────

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn copy-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? "Copiado ✓" : label}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="code">
      <pre>{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}

const fmtTokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} mil` : fmtInt(n);
const fmtMs = (ms: number) =>
  ms >= 1000
    ? `${(ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s`
    : `${Math.round(ms)} ms`;
const STATUS: Record<McpCallItem["status"], { label: string; cls: string }> = {
  ok: { label: "Correcta", cls: "ok" },
  error: { label: "Error", cls: "bad" },
  denied: { label: "Denegada", cls: "bad" },
  rate_limited: { label: "Límite", cls: "warn" },
};

// ── Página ───────────────────────────────────────────────────────────────────

export function IaPage({ me }: { me: SessionUser }) {
  const { search } = useLocation();
  const tab = (TABS.find((t) => t.key === search.get("tab"))?.key ?? "conectar") as Tab;
  const all = me.admin && search.get("ver") === "equipo";
  const info = useMcpInfo();
  const url = info.data?.url ?? `${location.origin}/mcp`;

  return (
    <>
      <div className="ia-head">
        <div>
          <h1>Conecta tu IA</h1>
          <p>
            Pregunta por las llamadas en lenguaje natural desde Claude, ChatGPT o Cursor. Solo lectura, con
            tus permisos.
          </p>
        </div>
        <div className="endpoint">
          <span className="dot ok" />
          <code>{url}</code>
          <CopyButton text={url} />
        </div>
      </div>
      <div className="ia-tabs">
        <div className="segmented" role="tablist" aria-label="Secciones del MCP">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-pressed={tab === t.key}
              onClick={() => setParams({ tab: t.key === "conectar" ? null : t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
        {me.admin && tab !== "conectar" ? (
          <div className="segmented" role="group" aria-label="Alcance">
            <button type="button" aria-pressed={!all} onClick={() => setParams({ ver: null })}>
              Solo yo
            </button>
            <button type="button" aria-pressed={all} onClick={() => setParams({ ver: "equipo" })}>
              Todo el equipo
            </button>
          </div>
        ) : null}
      </div>
      {tab === "conectar" ? <Connect url={url} /> : null}
      {tab === "tokens" ? <Tokens url={url} all={all} me={me} /> : null}
      {tab === "actividad" ? <Activity all={all} /> : null}
      {tab === "consumo" ? <Usage all={all} /> : null}
    </>
  );
}

// ── Conectar ─────────────────────────────────────────────────────────────────

/** Ejemplos con nombres del equipo real (los tres primeros activos), para copiarlos tal cual. */
function examples(names: string[]) {
  const [a = "Ana", b = "Luis", c = "Marta"] = names;
  const three = `${a}, ${b} y ${c}`;
  return {
    group: three,
    list: [
      "¿Cómo va hoy el equipo comparado con el jueves pasado?",
      `¿Cómo van esta semana ${three} juntos?`,
      "¿Qué leads calientes llevan 3 días sin que nadie los llame?",
      "Compara a todos los comerciales esta semana",
      `Ranking de llamadas nuevas de ${three} este mes`,
      "¿A qué hora contesta más la gente?",
      `Hazme el informe semanal de ${a} y ${b} para Slack`,
      "¿Quién está conectado sin llamar ahora mismo?",
    ],
  };
}

/** Qué se le puede pedir a cada herramienta, en palabras (a partir de sus parámetros). */
function paramChips(params: string[]): { label: string; group?: boolean }[] {
  const has = (...k: string[]) => k.some((x) => params.includes(x));
  const out: { label: string; group?: boolean }[] = [];
  if (has("periodo", "desde", "periodo_a", "a_desde")) out.push({ label: "Fechas" });
  else if (has("fecha")) out.push({ label: "Un día" });
  if (has("agrupar")) out.push({ label: "Día, semana o mes" });
  if (has("comercial")) out.push({ label: "Un comercial" });
  if (has("comerciales")) out.push({ label: "Grupo de comerciales", group: true });
  if (has("metrica")) out.push({ label: "Métrica" });
  if (has("resultado")) out.push({ label: "Filtros" });
  else if (has("tipo")) out.push({ label: "Diario o semanal" });
  if (has("numero")) out.push({ label: "Teléfono" });
  if (has("minutos_minimos", "dias_sin_llamar")) out.push({ label: "Umbrales" });
  return out;
}

function ParamChips({ params }: { params: string[] }) {
  const chips = paramChips(params);
  if (!chips.length) return null;
  return (
    <div className="tool-params" role="list" aria-label="Acepta">
      {chips.map((c) => (
        <span key={c.label} role="listitem" className={`tool-param${c.group ? " group" : ""}`}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Connect({ url }: { url: string }) {
  const info = useMcpInfo();
  const agents = useAgentOptions().data?.agents ?? [];
  const ex = examples(
    agents.filter((x) => x.active && x.id !== 0).map((x) => x.name.split(/\s+/)[0] as string),
  );
  return (
    <>
      <div className="connect-grid">
        <section className="card connect-card">
          <span className="tag admin">Recomendado · sin tokens</span>
          <h2>Claude (web, escritorio y móvil)</h2>
          <ol>
            <li>
              En Claude, abre <b>Ajustes → Conectores → Añadir conector personalizado</b>.
            </li>
            <li>
              Nombre: <b>Ringover 4Geeks</b>. URL:
              <Code>{url}</Code>
            </li>
            <li>
              Pulsa <b>Conectar</b>, entra con tu cuenta (Google o Center) y pulsa <b>Permitir acceso</b>.
            </li>
          </ol>
          <p className="muted small">
            ChatGPT funciona igual: Ajustes → Conectores → Crear, con la misma URL.
          </p>
        </section>
        <section className="card connect-card">
          <span className="tag">Terminal</span>
          <h2>Claude Code</h2>
          <ol>
            <li>
              Añade el servidor:
              <Code>{`claude mcp add --transport http --scope user ringover ${url}`}</Code>
            </li>
            <li>
              Dentro de Claude Code escribe <b>/mcp</b>, elige <b>ringover</b> e inicia sesión.
            </li>
          </ol>
          <p className="muted small">
            ¿Prefieres un token fijo? Genéralo en la pestaña Tokens y te damos el comando listo.
          </p>
        </section>
        <section className="card connect-card">
          <span className="tag">Con token</span>
          <h2>Cursor y otros clientes</h2>
          <ol>
            <li>Genera un token personal en la pestaña Tokens.</li>
            <li>
              Pégalo en la configuración MCP del cliente:
              <Code>{`{
  "mcpServers": {
    "ringover": {
      "url": "${url}",
      "headers": { "Authorization": "Bearer TU_TOKEN" }
    }
  }
}`}</Code>
            </li>
          </ol>
        </section>
      </div>

      <div className="section-title">
        <h2>Prueba a preguntar</h2>
        <span className="hint">Toca una para copiarla</span>
      </div>
      <div className="examples">
        {ex.list.map((e) => (
          <button
            key={e}
            type="button"
            className="example"
            onClick={() => void navigator.clipboard?.writeText(e)}
          >
            “{e}”
          </button>
        ))}
      </div>

      <div className="section-title">
        <h2>Qué puede hacer</h2>
        <span className="hint">
          {info.data
            ? `${info.data.tools.length} herramientas · ${info.data.prompts.length} informes listos · ${info.data.resources.length} recursos`
            : ""}
        </span>
      </div>
      {!info.data ? (
        <Skeleton h={120} />
      ) : (
        <>
          <p className="tool-legend">
            <span className="tool-param group">Grupo de comerciales</span>
            Las que lo llevan aceptan varios a la vez: pregunta «¿cómo van {ex.group}?» y todas las cifras
            serán solo de ellos.
          </p>
          <div className="tool-grid">
            {info.data.tools.map((t) => (
              <div key={t.name} className="card tool">
                <div className="tool-name">
                  <b>{t.title}</b>
                  <code>{t.name}</code>
                </div>
                <p>{t.description}</p>
                <ParamChips params={t.params ?? []} />
              </div>
            ))}
          </div>
          <div className="section-title">
            <h2>Informes listos</h2>
            <span className="hint">Aparecen como comandos en Claude (por ejemplo, /informe_semanal)</span>
          </div>
          <div className="tool-grid">
            {info.data.prompts.map((p) => (
              <div key={p.name} className="card tool">
                <div className="tool-name">
                  <b>{p.title}</b>
                  <code>/{p.name}</code>
                </div>
                <p>{p.description}</p>
                <ParamChips params={p.params ?? []} />
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>
            Límite por token: {info.data.limits.perMin} consultas por minuto y{" "}
            {fmtInt(info.data.limits.perDay)} al día.
          </p>
        </>
      )}
    </>
  );
}

// ── Tokens ───────────────────────────────────────────────────────────────────

const EXPIRY: { label: string; value: 30 | 90 | 365 | null }[] = [
  { label: "30 días", value: 30 },
  { label: "90 días", value: 90 },
  { label: "1 año", value: 365 },
  { label: "Sin caducidad", value: null },
];

function Tokens({ url, all, me }: { url: string; all: boolean; me: SessionUser }) {
  const q = useMcpTokens(all);
  const revoke = useRevokeToken();
  const now = useNow(30_000);
  const [creating, setCreating] = useState(false);
  const tokens = q.data?.tokens ?? [];

  return (
    <>
      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>{all ? "Tokens y conexiones del equipo" : "Tus tokens y conexiones"}</h2>
        <span className="hint">Las conexiones de Claude o ChatGPT aparecen solas al autorizarlas</span>
        <button
          type="button"
          className="btn primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setCreating(true)}
        >
          Nuevo token
        </button>
      </div>
      <div className="card">
        {!q.data ? (
          <div style={{ padding: 20 }}>
            <Skeleton h={22} />
          </div>
        ) : tokens.length === 0 ? (
          <Empty title="Todavía no hay tokens ni conexiones">
            Crea un token o conecta Claude desde la pestaña Conectar.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table className="data calls">
              <thead>
                <tr>
                  <th>Nombre</th>
                  {all ? <th>Persona</th> : null}
                  <th>Último uso</th>
                  <th className="r">Hoy</th>
                  <th className="r">30 días</th>
                  <th>Caduca</th>
                  <th>Estado</th>
                  <th className="r" aria-label="Revocar" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <TokenRow
                    key={t.id}
                    t={t}
                    all={all}
                    now={now}
                    mine={t.owner.email === me.email.toLowerCase()}
                    onRevoke={() => {
                      if (window.confirm(`¿Revocar «${t.name}»? Dejará de funcionar al momento.`))
                        revoke.mutate(t.id);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating ? <CreateToken url={url} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function TokenRow({
  t,
  all,
  now,
  mine,
  onRevoke,
}: {
  t: McpTokenItem;
  all: boolean;
  now: number;
  mine: boolean;
  onRevoke: () => void;
}) {
  const kind =
    t.kind === "oauth" ? "Conexión OAuth" : t.kind === "config" ? "Configuración" : "Token personal";
  return (
    <tr className={t.status !== "activo" ? "dim" : undefined}>
      <td>
        <div style={{ fontWeight: 600 }}>{t.name}</div>
        <div className="muted" style={{ fontSize: 12 }}>
          {kind}
          {t.prefix ? (
            <>
              {" · "}
              <code>{t.prefix}…</code>
            </>
          ) : null}
        </div>
      </td>
      {all ? <td className="muted">{t.owner.name ?? t.owner.email}</td> : null}
      <td>
        {t.lastUsedMs ? relativeTime(t.lastUsedMs, now) : <span className="muted">Nunca</span>}
        {t.lastClient ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {t.lastClient}
          </div>
        ) : null}
      </td>
      <td className="r num">{fmtInt(t.callsToday)}</td>
      <td className="r num">{fmtInt(t.calls30d)}</td>
      <td className="muted">
        {t.expiresMs ? fmtDayShort(localDay(t.expiresMs)) : t.kind === "oauth" ? "Se renueva sola" : "Nunca"}
      </td>
      <td>
        <span className={`status-chip ${t.status === "activo" ? "ok" : "bad"}`}>
          {t.status === "activo" ? "Activo" : t.status === "caducado" ? "Caducado" : "Revocado"}
        </span>
      </td>
      <td className="r">
        {t.status === "activo" && t.kind !== "config" && (mine || all) ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Revocar ${t.name}`}
            title="Revocar"
            onClick={onRevoke}
          >
            <IconX />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function CreateToken({ url, onClose }: { url: string; onClose: () => void }) {
  const create = useCreateToken();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState<30 | 90 | 365 | null>(90);
  const token = create.data?.token;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-back" onClick={onClose} aria-hidden="true" />
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Nuevo token">
        <div className="modal-head">
          <h2>{token ? "Tu token está listo" : "Nuevo token personal"}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}>
            <IconX />
          </button>
        </div>
        {!token ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ name, expiresDays: expires });
            }}
          >
            <label className="field">
              Nombre (para reconocerlo luego)
              <input
                className="input"
                required
                maxLength={80}
                placeholder="Claude Code del portátil"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <div className="field" style={{ marginTop: 14 }}>
              Caduca
              <div className="segmented" role="group" aria-label="Caducidad">
                {EXPIRY.map((x) => (
                  <button
                    key={x.label}
                    type="button"
                    aria-pressed={expires === x.value}
                    onClick={() => setExpires(x.value)}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
            {create.error ? (
              <div className="form-error" role="alert" style={{ marginTop: 12 }}>
                {create.error.message}
              </div>
            ) : null}
            <button
              type="submit"
              className="btn primary"
              style={{ width: "100%", marginTop: 18 }}
              disabled={create.isPending}
            >
              Crear token
            </button>
          </form>
        ) : (
          <div className="token-ready">
            <div className="notice warn">
              <IconAlert />
              Cópialo ahora: por seguridad no se volverá a mostrar. Si lo pierdes, revócalo y crea otro.
            </div>
            <Code>{token}</Code>
            <h3>Claude Code</h3>
            <Code>{`claude mcp add --transport http --scope user ringover ${url} --header "Authorization: Bearer ${token}"`}</Code>
            <h3>Cursor y otros (JSON)</h3>
            <Code>{`{ "mcpServers": { "ringover": { "url": "${url}", "headers": { "Authorization": "Bearer ${token}" } } } }`}</Code>
            <button type="button" className="btn" style={{ width: "100%", marginTop: 16 }} onClick={onClose}>
              Hecho
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ── Actividad ────────────────────────────────────────────────────────────────

function Activity({ all }: { all: boolean }) {
  const info = useMcpInfo();
  const [tool, setTool] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<McpCallItem | null>(null);
  const q = useMcpLog({ all, tool: tool || undefined, status: status || undefined });
  const now = useNow(30_000);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="card">
      <div className="filters">
        <select
          className="select"
          aria-label="Herramienta"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
        >
          <option value="">Todas las herramientas</option>
          {info.data?.tools.map((t) => (
            <option key={t.name} value={t.name}>
              {t.title}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Estado"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Cualquier estado</option>
          <option value="ok">Correctas</option>
          <option value="error">Con error</option>
          <option value="denied">Denegadas</option>
          <option value="rate_limited">Por límite</option>
        </select>
        <span className="count">Se actualiza cada 30 s</span>
      </div>
      {!q.data ? (
        <div style={{ padding: 20, display: "grid", gap: 10 }}>
          <Skeleton h={22} />
          <Skeleton h={22} />
        </div>
      ) : items.length === 0 ? (
        <Empty title="Sin actividad todavía">Cuando alguien use el MCP, cada consulta aparecerá aquí.</Empty>
      ) : (
        <div className={`table-scroll loading-frame${q.isPlaceholderData ? " stale" : ""}`}>
          <table className="data calls">
            <thead>
              <tr>
                <th>Cuándo</th>
                {all ? <th>Persona</th> : null}
                <th>App</th>
                <th>Herramienta</th>
                <th className="r">Duración</th>
                <th className="r">Contexto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="clickable"
                  onClick={() => setOpen(c)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setOpen(c)}
                >
                  <td title={new Date(c.tsMs).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}>
                    {relativeTime(c.tsMs, now)}
                  </td>
                  {all ? <td className="muted">{c.ownerEmail ?? "—"}</td> : null}
                  <td className="muted">{c.client ?? c.tokenName ?? "—"}</td>
                  <td>
                    <code>{c.tool ?? c.method}</code>
                  </td>
                  <td className="r num">{fmtMs(c.durationMs)}</td>
                  <td className="r num muted">≈ {fmtTokens(Math.round(c.bytes / 4))}</td>
                  <td>
                    <span className={`status-chip ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.hasNextPage ? (
            <div className="load-more">
              <button
                type="button"
                className="btn"
                onClick={() => q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? "Cargando…" : "Ver más"}
              </button>
            </div>
          ) : null}
        </div>
      )}
      {open ? <CallDetail c={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function CallDetail({ c, onClose }: { c: McpCallItem; onClose: () => void }) {
  let args = c.args ?? "";
  try {
    args = c.args ? JSON.stringify(JSON.parse(c.args), null, 2) : "Sin argumentos";
  } catch {
    // argumentos recortados: se enseñan tal cual
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Detalle de la consulta">
        <header>
          <div style={{ flex: 1 }}>
            <h2>
              <code>{c.tool ?? c.method}</code>
            </h2>
            <p>
              {new Date(c.tsMs).toLocaleString("es-ES", {
                timeZone: "Europe/Madrid",
                dateStyle: "full",
                timeStyle: "medium",
              })}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX />
          </button>
        </header>
        <div className="body detail">
          <dl>
            <dt>Estado</dt>
            <dd>
              <span className={`status-chip ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
            </dd>
            <dt>Persona</dt>
            <dd>{c.ownerEmail ?? "—"}</dd>
            <dt>Token o conexión</dt>
            <dd>{c.tokenName ?? "—"}</dd>
            <dt>App</dt>
            <dd>{c.client ?? "—"}</dd>
            <dt>Duración</dt>
            <dd>{fmtMs(c.durationMs)}</dd>
            <dt>Respuesta</dt>
            <dd>
              {fmtInt(c.bytes)} bytes · ≈ {fmtTokens(Math.round(c.bytes / 4))} tokens de contexto
            </dd>
          </dl>
          {c.error ? <div className="form-error">{c.error}</div> : null}
          <h3>Argumentos</h3>
          <pre className="json">{args}</pre>
        </div>
      </aside>
    </>
  );
}

// ── Consumo ──────────────────────────────────────────────────────────────────

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

function Usage({ all }: { all: boolean }) {
  const [days, setDays] = useState(30);
  const q = useMcpUsage(days, all);
  const u = q.data;
  const maxTool = Math.max(1, ...(u?.byTool.map((t) => t.calls) ?? [1]));

  return (
    <>
      <div className="segmented" role="group" aria-label="Periodo" style={{ marginBottom: 16 }}>
        {RANGES.map((r) => (
          <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>
      {!u ? (
        <Skeleton h={300} />
      ) : (
        <div className={`loading-frame${q.isPlaceholderData ? " stale" : ""}`}>
          <div className="usage-kpis">
            <Stat
              label="Consultas"
              value={fmtInt(u.totals.calls)}
              sub={`${fmtInt(u.totals.blocked)} bloqueadas por token o límite`}
            />
            <Stat
              label="Personas"
              value={fmtInt(u.totals.people)}
              sub={`${fmtInt(u.totals.connections)} tokens o conexiones`}
            />
            <Stat
              label="Errores"
              value={u.totals.calls ? fmtPct(u.totals.errors / u.totals.calls) : "—"}
              sub={`${fmtInt(u.totals.errors)} consultas`}
            />
            <Stat label="Latencia p95" value={fmtMs(u.totals.p95Ms)} sub={`Media ${fmtMs(u.totals.avgMs)}`} />
            <Stat
              label="Contexto servido"
              value={`≈ ${fmtTokens(u.totals.approxTokens)}`}
              sub="tokens que han leído las IA"
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h2>Consultas por día</h2>
                <div className="right legend">
                  <span>
                    <i style={{ background: "var(--accent)" }} />
                    Correctas
                  </span>
                  <span>
                    <i style={{ background: "#d03b3b" }} />
                    Con error
                  </span>
                </div>
              </div>
              <div className="card-body">
                <Columns
                  data={u.series.map((p) => ({
                    key: p.day,
                    label: fmtDayShort(p.day).split(" ").slice(1, 3).join(" "),
                    title: fmtDayShort(p.day),
                    values: [p.ok, p.error],
                  }))}
                  series={[
                    { label: "Correctas", color: "var(--accent)" },
                    { label: "Con error", color: "#d03b3b" },
                  ]}
                  height={220}
                  ariaLabel="Consultas al MCP por día"
                  formatTotal={(_d, t) => <TipRow label="Total" value={t} />}
                />
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Desde qué apps</h2>
              </div>
              <div className="card-body">
                {u.byClient.length === 0 ? (
                  <Empty title="Sin datos" />
                ) : (
                  <div className="bars">
                    {u.byClient.map((c) => (
                      <div key={c.client} className="bar-row">
                        <span>{c.client}</span>
                        <b className="num">{fmtInt(c.calls)}</b>
                        <i
                          style={{ width: `${(c.calls / Math.max(1, u.byClient[0]?.calls ?? 1)) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h2>Por herramienta</h2>
                <span className="hint">Qué se pregunta más y cuánto contexto consume</span>
              </div>
              <div className="table-scroll">
                <table className="data calls">
                  <thead>
                    <tr>
                      <th>Herramienta</th>
                      <th className="r">Consultas</th>
                      <th className="r">Media</th>
                      <th className="r">Contexto</th>
                      <th className="r">Errores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.byTool.map((t) => (
                      <tr key={t.tool}>
                        <td>
                          <code>{t.tool}</code>
                          <span className="inline-bar">
                            <i style={{ width: `${(t.calls / maxTool) * 100}%` }} />
                          </span>
                        </td>
                        <td className="r num">{fmtInt(t.calls)}</td>
                        <td className="r num">{fmtMs(t.avgMs)}</td>
                        <td className="r num">≈ {fmtTokens(t.approxTokens)}</td>
                        <td className={`r num${t.errors ? " bad-text" : " muted"}`}>{fmtInt(t.errors)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {u.byTool.length === 0 ? <Empty title="Sin consultas en este periodo" /> : null}
              </div>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Por persona</h2>
              </div>
              <div className="table-scroll">
                <table className="data calls">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th className="r">Consultas</th>
                      <th className="r">Contexto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.byPerson.map((p) => (
                      <tr key={p.email}>
                        <td>{p.email}</td>
                        <td className="r num">{fmtInt(p.calls)}</td>
                        <td className="r num">≈ {fmtTokens(p.approxTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {u.byPerson.length === 0 ? <Empty title="Nadie todavía" /> : null}
              </div>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>
            Límite por token: {u.limits.perMin} consultas por minuto y {fmtInt(u.limits.perDay)} al día. El
            contexto es aproximado (≈ 4 caracteres por token).
          </p>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-sub">{sub}</span>
    </div>
  );
}
