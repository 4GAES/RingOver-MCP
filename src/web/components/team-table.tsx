import { useState } from "react";
import type { AgentRow } from "../../shared/api";
import { fmtClock, fmtDelta, fmtDuration, fmtInt } from "../../shared/format";
import { delta, GROUPS, METRICS, type MetricKey, type Metrics } from "../../shared/metrics";
import { useNow } from "../lib/hooks";
import { periodQuery } from "../lib/period";
import { navigate } from "../lib/router";
import { IconDown, IconSort, IconUp } from "./icons";
import { Avatar, deltaClass, liveLabel } from "./ui";

type SortKey = MetricKey | "name";

const value = (m: Metrics, k: MetricKey) => m[k];

/** Tabla del equipo: cada comercial se compara consigo mismo (variación bajo cada cifra). */
export function TeamTable({
  rows,
  totals,
  from,
  to,
  totalLabel = "Equipo",
}: {
  rows: AgentRow[];
  totals: Metrics;
  from: string;
  to: string;
  totalLabel?: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "llamadas", dir: -1 });
  const now = useNow();
  const max = Object.fromEntries(
    METRICS.map((d) => [d.key, Math.max(1, ...rows.map((r) => value(r.current, d.key) ?? 0))]),
  ) as Record<MetricKey, number>;

  const sorted = [...rows].sort((a, b) => {
    if (sort.key === "name") return a.agent.name.localeCompare(b.agent.name) * sort.dir;
    return ((value(a.current, sort.key) ?? -1) - (value(b.current, sort.key) ?? -1)) * sort.dir;
  });

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 },
    );

  const ariaSort = (k: SortKey) =>
    sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined;

  const fmt = (k: MetricKey, v: number | null) => {
    if (v === null) return "—";
    const def = METRICS.find((d) => d.key === k);
    return def?.kind === "duration" ? fmtClock(v) : fmtInt(v);
  };

  return (
    <div className="card">
      <div className="table-scroll">
        <table className="data team">
          <thead>
            <tr>
              <th className="group" />
              {GROUPS.map((g) => (
                <th key={g.key} className="group" colSpan={3}>
                  <span>{g.label}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th aria-sort={ariaSort("name")}>
                <button type="button" onClick={() => toggle("name")}>
                  Comercial {sort.key === "name" ? sort.dir === 1 ? <IconUp /> : <IconDown /> : <IconSort />}
                </button>
              </th>
              {METRICS.map((d, i) => (
                <th key={d.key} aria-sort={ariaSort(d.key)} className={i % 3 === 0 ? "divider" : undefined}>
                  <button type="button" onClick={() => toggle(d.key)} title={d.definition}>
                    {d.short}
                    {sort.key === d.key ? sort.dir === 1 ? <IconUp /> : <IconDown /> : <IconSort />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const href = `/comercial/${r.agent.id}${periodQuery(from, to)}`;
              const live = liveLabel(r.live, now);
              return (
                <tr
                  key={r.agent.id}
                  className="clickable"
                  onClick={() => navigate(href)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(href)}
                  tabIndex={0}
                >
                  <td>
                    <div className="who">
                      <Avatar agent={r.agent} live={r.live} />
                      <div>
                        <div className="name">{r.agent.name}</div>
                        <div className="state">
                          {r.agent.id === 0 ? "Entrantes sin comercial" : live.text}
                        </div>
                      </div>
                    </div>
                  </td>
                  {METRICS.map((d, i) => {
                    const v = value(r.current, d.key);
                    const dd = delta(v, value(r.previous, d.key));
                    const cls = deltaClass(dd, d.upIsGood);
                    return (
                      <td key={d.key} className={i % 3 === 0 ? "divider" : undefined}>
                        <span className="cell">
                          <span title={d.kind === "duration" && v !== null ? fmtDuration(v) : undefined}>
                            {fmt(d.key, v)}
                          </span>
                          <span className="bar" aria-hidden="true">
                            <i style={{ width: `${((v ?? 0) / max[d.key]) * 100}%` }} />
                          </span>
                          <span className={`d ${cls}`}>{dd === null ? " " : fmtDelta(dd)}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>{totalLabel}</td>
              {METRICS.map((d, i) => (
                <td key={d.key} className={i % 3 === 0 ? "divider" : undefined}>
                  {fmt(d.key, value(totals, d.key))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
