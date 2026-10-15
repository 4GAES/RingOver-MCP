import { DurationCard, HoursCard, LiveCard, TrendCard } from "../components/cards";
import { IconAlert } from "../components/icons";
import { Headline, KpiGrid, KpiSkeleton } from "../components/kpis";
import { PeriodBar } from "../components/period-bar";
import { TeamTable } from "../components/team-table";
import { Skeleton } from "../components/ui";
import { useLive, useOverview } from "../lib/api";
import { usePeriod } from "../lib/period";
import { useSelection } from "../lib/selection";

export function StatusNotices({ status }: { status: import("../../shared/api").DataStatus }) {
  return (
    <>
      {status.backfillRunning ? (
        <div className="notice">
          <IconAlert />
          Cargando el histórico de Ringover. Las cifras de días antiguos se irán completando en unos minutos.
        </div>
      ) : null}
      {status.lastError ? (
        <div className="notice warn">
          <IconAlert />
          La última sincronización con Ringover falló ({status.lastError}). Se reintentará sola.
        </div>
      ) : null}
    </>
  );
}

export function OverviewPage() {
  const p = usePeriod();
  const sel = useSelection();
  const o = useOverview(p.from, p.to, p.today, sel.key);
  const live = useLive();
  const d = o.data;
  // Con selección, la frase habla de ellos: el nombre si es uno, "los N comerciales elegidos" si son más.
  const n = sel.ids.length;
  const who =
    n === 0
      ? "equipo"
      : n === 1
        ? (d?.agents.find((a) => a.agent.id === sel.ids[0])?.agent.name ?? "el comercial elegido")
        : `los ${n} comerciales elegidos`;

  return (
    <>
      <PeriodBar compare={d?.compare} picker />
      {o.error && !d ? (
        <div className="notice warn">
          <IconAlert /> {o.error.message}
        </div>
      ) : null}
      {!d ? (
        <>
          <Skeleton h={22} w="60%" />
          <div style={{ height: 22 }} />
          <KpiSkeleton />
        </>
      ) : (
        <div className={`loading-frame${o.isPlaceholderData ? " stale" : ""}`}>
          <StatusNotices status={d.status} />
          <Headline period={d.period} m={d.totals} who={who} plural={n > 1} />
          <KpiGrid
            totals={d.totals}
            previous={d.previous}
            compare={d.compare}
            series={d.series.points}
            status={d.status}
          />

          <div className="section-title">
            <h2>Por comercial</h2>
            <span className="hint">
              La cifra pequeña compara a cada uno consigo mismo en el periodo anterior
            </span>
          </div>
          {d.agents.length ? (
            <TeamTable
              rows={d.agents}
              totals={d.totals}
              from={p.from}
              to={p.to}
              totalLabel={n ? "Selección" : "Equipo"}
            />
          ) : (
            <div className="card">
              <div className="empty">
                <strong>Sin actividad en este periodo</strong>
              </div>
            </div>
          )}

          <div className="grid-2">
            <TrendCard o={d} />
            <LiveCard live={live.data} from={p.from} to={p.to} only={sel.ids} />
          </div>
          <div className="grid-2">
            <HoursCard hours={d.hours} days={d.period.days} />
            <DurationCard buckets={d.durations} />
          </div>
        </div>
      )}
    </>
  );
}
