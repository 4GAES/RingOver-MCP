import { useMemo, useRef, useState } from "react";
import type { AgentOption } from "../../shared/api";
import { useAgentOptions } from "../lib/api";
import { relativeTime, useDismiss } from "../lib/hooks";
import { useSelection } from "../lib/selection";
import { IconSearch, IconUsers } from "./icons";
import { Avatar } from "./ui";

// Selección múltiple de comerciales para el Resumen y las Llamadas. Se elige en borrador y
// se aplica con un botón (como las fechas): una sola consulta, no una por casilla.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/** Texto del botón: "Todo el equipo", el nombre si es uno, o "N comerciales". */
export function selectionLabel(ids: number[], agents: AgentOption[] | undefined): string {
  if (!ids.length) return "Todo el equipo";
  if (ids.length === 1) return agents?.find((a) => a.id === ids[0])?.name ?? "1 comercial";
  return `${ids.length} comerciales`;
}

export function AgentPicker() {
  const sel = useSelection();
  const options = useAgentOptions();
  const agents = options.data?.agents;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<number>>(new Set());
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const byId = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const chosen = sel.ids.map((id) => byId.get(id)).filter((a): a is AgentOption => !!a);
  const q = norm(text.trim());
  const visible = (agents ?? []).filter(
    (a) => !q || norm(a.name).includes(q) || norm(a.email ?? "").includes(q),
  );
  const groups: [string, AgentOption[]][] = [
    ["Con llamadas en los últimos 60 días", visible.filter((a) => a.active)],
    ["Sin llamadas recientes", visible.filter((a) => !a.active)],
  ];

  const toggle = (id: number) =>
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allVisibleOn = visible.length > 0 && visible.every((a) => draft.has(a.id));
  const now = Date.now();

  return (
    <div className="pop-anchor" ref={ref}>
      <button
        type="button"
        className="btn agent-btn"
        aria-pressed={sel.ids.length > 0}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setDraft(new Set(sel.ids));
          setText("");
          setOpen((o) => !o);
        }}
      >
        {chosen.length ? (
          <span className="avatar-stack" aria-hidden="true">
            {chosen.slice(0, 3).map((a) => (
              <Avatar key={a.id} agent={a} />
            ))}
          </span>
        ) : (
          <IconUsers />
        )}
        <span className="agent-btn-label">{selectionLabel(sel.ids, agents)}</span>
      </button>

      {open ? (
        <form
          className="popover left agent-pop"
          role="dialog"
          aria-label="Elegir comerciales"
          onSubmit={(e) => {
            e.preventDefault();
            sel.set([...draft]);
            setOpen(false);
          }}
        >
          <label className="search agent-search">
            <IconSearch />
            <input
              className="input"
              type="search"
              placeholder="Buscar comercial"
              aria-label="Buscar comercial"
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="agent-tools">
            <span>
              {draft.size ? `${draft.size} elegido${draft.size === 1 ? "" : "s"}` : "Todo el equipo"}
            </span>
            <button
              type="button"
              className="link-btn"
              disabled={!visible.length}
              onClick={() =>
                setDraft((d) => {
                  const n = new Set(d);
                  for (const a of visible) {
                    if (allVisibleOn) n.delete(a.id);
                    else n.add(a.id);
                  }
                  return n;
                })
              }
            >
              {allVisibleOn ? "Quitar" : "Marcar"} {q ? "los que salen" : "todos"}
            </button>
          </div>

          <div className="agent-list">
            {!agents ? (
              <p className="agent-empty">Cargando comerciales…</p>
            ) : !visible.length ? (
              <p className="agent-empty">Nadie se llama «{text}».</p>
            ) : (
              groups.map(([title, list]) =>
                list.length ? (
                  <fieldset key={title} className="agent-group">
                    <legend>{title}</legend>
                    {list.map((a) => (
                      <label key={a.id} className="agent-row">
                        <input type="checkbox" checked={draft.has(a.id)} onChange={() => toggle(a.id)} />
                        <Avatar agent={a} />
                        <span className="agent-name">
                          <b>{a.name}</b>
                          <span>
                            {a.lastCallMs
                              ? `Última llamada ${relativeTime(a.lastCallMs, now)}`
                              : "Sin llamadas"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                ) : null,
              )
            )}
          </div>

          <div className="agent-foot">
            <button type="button" className="btn" disabled={!draft.size} onClick={() => setDraft(new Set())}>
              Limpiar
            </button>
            <button type="submit" className="btn primary">
              {draft.size
                ? `Ver ${draft.size} comercial${draft.size === 1 ? "" : "es"}`
                : "Ver todo el equipo"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
