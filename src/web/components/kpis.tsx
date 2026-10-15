import type { CompareInfo, DataStatus, PeriodInfo, SeriesPoint } from "../../shared/api";
import {
  capitalize,
  fmtDayLong,
  fmtDayShort,
  fmtDuration,
  fmtInt,
  fmtPct,
  fmtRange,
} from "../../shared/format";
import { GROUPS, METRICS, type MetricDef, type Metrics } from "../../shared/metrics";
import { weekday } from "../../shared/time";
import { Sparkline } from "./charts";
import { Delta, DurationValue, InfoTip, Skeleton } from "./ui";

const pct = (a: number, b: number) => (b > 0 ? fmtPct(a / b) : "—");

function subline(def: MetricDef, m: Metrics, status: DataStatus): string {
  switch (def.key) {
    case "llamadas":
      return m.llamadas
        ? `${fmtInt(m.contestadas)} contestadas · ${pct(m.contestadas, m.llamadas)}`
        : "Sin llamadas";
    case "nuevas":
      return m.llamadas ? `${pct(m.nuevas, m.llamadas)} del total` : "";
    case "antiguas":
      return m.llamadas ? `${pct(m.antiguas, m.llamadas)} del total · seguimientos` : "";
    case "tiempo_llamada":
      return m.contestadas
        ? `Media de ${fmtDuration(m.tiempo_llamada / m.contestadas)} por conversación`
        : "";
    case "tiempo_telefono":
      return m.llamadas
        ? `${fmtDuration(Math.max(0, m.tiempo_telefono - m.tiempo_llamada))} en tono y espera`
        : "";
    case "tiempo_conectado":
      if (m.tiempo_conectado === null) {
        if (status.presenceStatus === "sin_permiso") return "Falta el permiso Monitoring en Ringover";
        return status.presenceSinceMs
          ? `Se mide desde el ${fmtDayShort(new Date(status.presenceSinceMs).toISOString().slice(0, 10))}`
          : "Empieza a medirse al arrancar la app";
      }
      return m.tiempo_conectado > 0
        ? `${pct(m.tiempo_llamada, m.tiempo_conectado)} del tiempo conectado hablando`
        : "";
    case "mas15":
      return m.contestadas ? `${pct(m.mas15, m.contestadas)} de las contestadas` : "";
    case "menos5":
      return m.contestadas ? `${pct(m.menos5, m.contestadas)} de las contestadas` : "";
    case "nuevas_mas15":
      return m.nuevas ? `${pct(m.nuevas_mas15, m.nuevas)} de las llamadas nuevas` : "";
  }
}

function prevLabel(c: CompareInfo): string {
  const until = c.partial
    ? ` hasta las ${new Date(c.endMs).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}`
    : "";
  return `${capitalize(fmtRange(c.from, c.to))}${until}`;
}

function Kpi({
  def,
  cur,
  prev,
  compare,
  series,
  status,
}: {
  def: MetricDef;
  cur: Metrics;
  prev: Metrics;
  compare: CompareInfo;
  series: SeriesPoint[];
  status: DataStatus;
}) {
  const v = cur[def.key];
  const fmt = (x: number | null) =>
    x === null ? "sin dato" : def.kind === "duration" ? fmtDuration(x) : fmtInt(x);
  return (
    <div className="card kpi" data-metric={def.key}>
      <div className="kpi-label">
        <span>{def.label}</span>
        <InfoTip title={def.label}>{def.definition}</InfoTip>
      </div>
      <Delta cur={v} prev={prev[def.key]} def={def} prevLabel={prevLabel(compare)} />
      <div className={`kpi-value${v === null ? " na" : ""}`}>
        {v === null ? "—" : def.kind === "duration" ? <DurationValue seconds={v} /> : fmtInt(v)}
      </div>
      <div className="kpi-sub">{subline(def, cur, status)}</div>
      <div className="kpi-spark">
        <Sparkline
          values={series.map((p) => p.m[def.key])}
          labels={series.map((p) => capitalize(fmtDayShort(p.day)))}
          format={fmt}
        />
      </div>
    </div>
  );
}

export function KpiGrid({
  totals,
  previous,
  compare,
  series,
  status,
}: {
  totals: Metrics;
  previous: Metrics;
  compare: CompareInfo;
  series: SeriesPoint[];
  status: DataStatus;
}) {
  return (
    <div className="kpi-groups">
      {GROUPS.map((g) => (
        <section key={g.key} className="kpi-group" aria-label={g.label}>
          <h3>{g.label}</h3>
          {METRICS.filter((m) => m.group === g.key).map((def) => (
            <Kpi
              key={def.key}
              def={def}
              cur={totals}
              prev={previous}
              compare={compare}
              series={series}
              status={status}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="kpi-groups">
      {GROUPS.map((g) => (
        <div key={g.key} className="kpi-group">
          <h3>{g.label}</h3>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card kpi" style={{ display: "block" }}>
              <Skeleton h={14} w="45%" />
              <div style={{ height: 12 }} />
              <Skeleton h={30} w="60%" />
              <div style={{ height: 10 }} />
              <Skeleton h={12} w="70%" />
              <div style={{ height: 12 }} />
              <Skeleton h={30} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** El periodo en una frase: lo primero que se lee. */
export function Headline({
  period,
  m,
  who,
  plural = false,
}: {
  period: PeriodInfo;
  m: Metrics;
  who: string;
  plural?: boolean;
}) {
  const until = new Date(period.endMs).toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
  });
  const isToday = period.partial && period.days === 1;
  const when = isToday
    ? `Hoy, hasta las ${until},`
    : period.days === 1
      ? `El ${fmtDayLong(period.from)}`
      : period.partial
        ? `Del ${fmtRange(period.from, period.to)} (hasta las ${until})`
        : `Del ${fmtRange(period.from, period.to)}`;
  const verb = isToday || period.partial ? (plural ? "llevan" : "lleva") : plural ? "hicieron" : "hizo";
  const subject = who === "equipo" ? "el equipo" : who;

  if (m.llamadas === 0) {
    const weekend = period.days === 1 && weekday(period.from) >= 5;
    return (
      <p className="headline">
        {when} {subject} no {isToday ? (plural ? "han hecho" : "ha hecho") : plural ? "hicieron" : "hizo"}{" "}
        llamadas{weekend ? ": es fin de semana" : ""}.
      </p>
    );
  }
  return (
    <p className="headline">
      {when} {subject} {verb} <b>{fmtInt(m.llamadas)} llamadas</b> ({fmtInt(m.nuevas)} nuevas) y{" "}
      <b>{fmtDuration(m.tiempo_llamada)}</b> de conversación.{" "}
      {m.mas15 > 0 ? (
        <>
          <b>{fmtInt(m.mas15)}</b> {m.mas15 === 1 ? "pasó" : "pasaron"} de 15 minutos
          {m.nuevas_mas15 > 0 ? (
            <>
              , <b>{fmtInt(m.nuevas_mas15)}</b>{" "}
              {m.nuevas_mas15 === 1 ? "de ellas fue una" : "de ellas fueron"} primera
              {m.nuevas_mas15 === 1 ? "" : "s"} conversaci{m.nuevas_mas15 === 1 ? "ón" : "ones"}.
            </>
          ) : (
            "."
          )}
        </>
      ) : (
        "Ninguna pasó de 15 minutos."
      )}
    </p>
  );
}
