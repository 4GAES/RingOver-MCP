import { useState } from "react";
import { CallsTable, NumberDrawer } from "../components/calls";
import { DurationCard, HoursCard, TrendCard } from "../components/cards";
import { IconAlert, IconArrowLeft } from "../components/icons";
import { Headline, KpiGrid, KpiSkeleton } from "../components/kpis";
import { PeriodBar } from "../components/period-bar";
import { Timeline } from "../components/timeline";
import { Avatar, liveLabel, Skeleton, StatusDot } from "../components/ui";
import { useAgent, useCalls } from "../lib/api";
import { useNow } from "../lib/hooks";
import { periodQuery, usePeriod } from "../lib/period";
import { Link } from "../lib/router";
import { StatusNotices } from "./overview";

export function AgentPage({ id }: { id: number }) {
  const p = usePeriod();
  const q = useAgent(id, p.from, p.to, p.today);
  const calls = useCalls({ from: p.from, to: p.to, agent: String(id) });
  const now = useNow(15_000);
  const [number, setNumber] = useState<string | null>(null);
  const d = q.data;
  const items = calls.data?.pages.flatMap((pg) => pg.items) ?? [];
  const total = calls.data?.pages[0]?.total ?? 0;

  return (
    <>
      <Link href={`/${periodQuery(p.from, p.to)}`} className="back">
        <IconArrowLeft /> Equipo
      </Link>
      {d ? (
        <div className="agent-head">
          <Avatar agent={d.agent} size="lg" />
          <div>
            <h1>{d.agent.name}</h1>
            <div className="sub">
              {d.agent.id !== 0 ? (
                <>
                  <StatusDot live={d.live} /> {liveLabel(d.live, now).text}
                  {d.agent.email ? <span>· {d.agent.email}</span> : null}
                </>
              ) : (
                "Llamadas entrantes que no llegó a coger ningún comercial"
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="agent-head">
          <Skeleton h={52} w={52} r={26} />
          <Skeleton h={28} w={220} />
        </div>
      )}
      <PeriodBar compare={d?.compare} />
      {q.error && !d ? (
        <div className="notice warn">
          <IconAlert /> {q.error.message}
        </div>
      ) : null}
      {!d ? (
        <KpiSkeleton />
      ) : (
        <div className={`loading-frame${q.isPlaceholderData ? " stale" : ""}`}>
          <StatusNotices status={d.status} />
          <Headline period={d.period} m={d.totals} who={d.agent.name.split(" ")[0] ?? d.agent.name} />
          <KpiGrid
            totals={d.totals}
            previous={d.previous}
            compare={d.compare}
            series={d.series.points}
            status={d.status}
          />

          {d.timeline ? (
            <>
              <div className="section-title">
                <h2>Jornada</h2>
                <span className="hint">Pasa el ratón por encima para ver cada llamada</span>
              </div>
              <div className="card">
                <div className="card-head">
                  <div className="legend">
                    <span>
                      <i style={{ background: "var(--nueva)" }} />
                      Nueva
                    </span>
                    <span>
                      <i style={{ background: "var(--antigua)" }} />
                      Antigua
                    </span>
                    <span>
                      <i style={{ background: "var(--ink-3)", opacity: 0.55, width: 3 }} />
                      Sin respuesta (más baja)
                    </span>
                    <span>
                      <i style={{ background: "var(--ink-3)", opacity: 0.38 }} />
                      Conectado
                    </span>
                    <span>
                      <i className="hatch" />
                      No molestar
                    </span>
                  </div>
                </div>
                <div className="card-body">
                  {d.timeline.calls.length || d.timeline.segments.length ? (
                    <Timeline data={d.timeline} now={now} />
                  ) : (
                    <div className="empty">
                      <strong>Sin actividad este día</strong>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}

          <div className="grid-2">
            <TrendCard o={d} />
            <DurationCard buckets={d.durations} />
          </div>
          <div style={{ marginTop: 16 }}>
            <HoursCard hours={d.hours} days={d.period.days} />
          </div>

          <div className="section-title">
            <h2>Llamadas</h2>
            <span className="hint">{total.toLocaleString("es-ES")} en el periodo</span>
          </div>
          <div className="card">
            <CallsTable items={items} showAgent={false} onNumber={setNumber} />
            {calls.hasNextPage ? (
              <div className="load-more">
                <button
                  type="button"
                  className="btn"
                  onClick={() => calls.fetchNextPage()}
                  disabled={calls.isFetchingNextPage}
                >
                  {calls.isFetchingNextPage ? "Cargando…" : "Ver más"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <NumberDrawer number={number} onClose={() => setNumber(null)} />
    </>
  );
}
