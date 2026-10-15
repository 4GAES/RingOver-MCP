import type { DurationBucket, HourPoint, LiveTeam, Overview } from "../../shared/api";
import { capitalize, fmtDayShort, fmtDayTiny, fmtDuration, fmtInt, fmtPct } from "../../shared/format";
import { useNow } from "../lib/hooks";
import { periodQuery } from "../lib/period";
import { Link } from "../lib/router";
import { Columns } from "./charts";
import { TipRow } from "./tooltip";
import { Avatar, Empty, liveLabel, StatusDot } from "./ui";

const SERIES = [
  { label: "Nuevas", color: "var(--nueva)" },
  { label: "Antiguas", color: "var(--antigua)" },
];

function Legend({ items }: { items: { label: string; color: string; hatch?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i
            className={i.hatch ? "hatch" : undefined}
            style={i.hatch ? undefined : { background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Evolución diaria (o semanal) de llamadas nuevas y antiguas; el día elegido destacado. */
export function TrendCard({ o, title }: { o: Pick<Overview, "series" | "period">; title?: string }) {
  const single = o.period.days === 1;
  const weekly = o.series.granularity === "week";
  const data = o.series.points.map((p) => ({
    key: p.day,
    label: weekly
      ? fmtDayTiny(p.day)
      : o.series.points.length > 16
        ? String(Number(p.day.slice(8)))
        : fmtDayShort(p.day).split(" ").slice(0, 2).join(" "),
    title: weekly ? `Semana del ${fmtDayTiny(p.day)}` : capitalize(fmtDayShort(p.day)),
    values: [p.m.nuevas, p.m.antiguas],
    highlight: single && p.day === o.period.from,
  }));
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title ?? "Evolución"}</h2>
        <span className="hint">{single ? "Últimos 14 días" : weekly ? "Por semanas" : "Por días"}</span>
        <div className="right">
          <Legend items={SERIES} />
        </div>
      </div>
      <div className="card-body">
        <Columns
          data={data}
          series={SERIES}
          height={230}
          ariaLabel="Llamadas nuevas y antiguas por día"
          formatTotal={(d, total) => {
            const p = o.series.points.find((x) => x.day === d.key);
            return (
              <>
                <TipRow label="Total" value={fmtInt(total)} />
                {p ? <TipRow label="En llamada" value={fmtDuration(p.m.tiempo_llamada)} /> : null}
                {p ? <TipRow label="+15 min" value={p.m.mas15} /> : null}
              </>
            );
          }}
        />
      </div>
    </div>
  );
}

/** A qué horas se llama. */
export function HoursCard({ hours, days }: { hours: HourPoint[]; days: number }) {
  const active = hours.filter((h) => h.nuevas + h.antiguas > 0).map((h) => h.hour);
  const from = Math.min(8, ...active);
  const to = Math.max(20, ...active);
  const slice = hours.filter((h) => h.hour >= from && h.hour <= to);
  const total = hours.reduce((a, h) => a + h.nuevas + h.antiguas, 0);
  const peak = [...hours].sort((a, b) => b.nuevas + b.antiguas - (a.nuevas + a.antiguas))[0];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ritmo por hora</h2>
        <span className="hint">
          {total && peak ? `Pico a las ${peak.hour}:00` : ""}
          {days > 1 ? " · total del periodo" : ""}
        </span>
        <div className="right">
          <Legend items={SERIES} />
        </div>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <Empty title="Sin llamadas en este periodo" />
        ) : (
          <Columns
            data={slice.map((h) => ({
              key: String(h.hour),
              label: `${h.hour}h`,
              title: `De ${h.hour}:00 a ${h.hour + 1}:00`,
              values: [h.nuevas, h.antiguas],
            }))}
            series={SERIES}
            height={200}
            ariaLabel="Llamadas por hora del día"
            formatTotal={(d, t) => {
              const h = hours.find((x) => String(x.hour) === d.key);
              return (
                <>
                  <TipRow label="Total" value={t} />
                  {h ? <TipRow label="Contestadas" value={h.contestadas} /> : null}
                </>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Cuánto duran las conversaciones, con los tramos −5 / 5–15 / +15 min marcados. */
export function DurationCard({ buckets }: { buckets: DurationBucket[] }) {
  const total = buckets.reduce((a, b) => a + b.count, 0);
  const sum = (z: DurationBucket["zone"]) =>
    buckets.filter((b) => b.zone === z).reduce((a, b) => a + b.count, 0);
  const zones = [
    { z: "corta" as const, label: "Menos de 5 min", color: "var(--z-corta)" },
    { z: "media" as const, label: "De 5 a 15 min", color: "var(--z-media)" },
    { z: "larga" as const, label: "15 min o más", color: "var(--z-larga)" },
  ];
  const colorOf = (z: DurationBucket["zone"]) => zones.find((x) => x.z === z)?.color ?? "var(--accent)";
  return (
    <div className="card">
      <div className="card-head">
        <h2>Duración de las conversaciones</h2>
        <span className="hint">{fmtInt(total)} contestadas</span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <Empty title="Sin conversaciones" />
        ) : (
          <>
            <Columns
              data={buckets.map((b) => ({
                key: String(b.minute),
                label: b.minute % 5 === 0 ? (b.minute === 30 ? "30+" : String(b.minute)) : "",
                title: b.minute === 30 ? "30 min o más" : `De ${b.minute} a ${b.minute + 1} min`,
                values: [b.count],
                color: colorOf(b.zone),
              }))}
              series={[{ label: "Llamadas", color: "var(--accent)" }]}
              sparseLabels
              height={170}
              ariaLabel="Número de conversaciones por minuto de duración"
              formatTotal={(_d, t) => <TipRow label="Conversaciones" value={t} />}
            />
            <div className="zone-labels">
              {zones.map((z) => (
                <div key={z.z} style={{ borderColor: z.color }}>
                  <b>
                    {fmtInt(sum(z.z))} <span className="muted">· {fmtPct(sum(z.z) / total)}</span>
                  </b>
                  {z.label}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Quién está conectado ahora mismo. */
export function LiveCard({
  live,
  from,
  to,
  only,
}: {
  live: LiveTeam | undefined;
  from: string;
  to: string;
  /** Selección de comerciales: si viene, solo se muestran ellos. */
  only?: number[];
}) {
  const now = useNow(15_000);
  const status = live?.status.presenceStatus;
  const filtered = only?.length ? new Set(only) : null;
  const agents = (live?.agents ?? []).filter((a) => !filtered || filtered.has(a.agent.id));
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ahora mismo</h2>
        <span className="hint">Se actualiza cada 30 s</span>
      </div>
      <div className="card-body" style={{ padding: "8px 0 6px" }}>
        {status === "sin_permiso" ? (
          <Empty title="Sin acceso a la presencia">
            Activa «Monitoring» en la clave de API de Ringover para ver quién está conectado.
          </Empty>
        ) : agents.length === 0 ? (
          <Empty title={filtered ? "Ninguno de los elegidos está conectado" : "Nadie conectado"}>
            Cuando {filtered ? "alguno" : "alguien"} abra Ringover aparecerá aquí.
          </Empty>
        ) : (
          <div className="live-list">
            {agents.map((a) => {
              const l = liveLabel(a.live, now);
              return (
                <Link
                  key={a.agent.id}
                  className="live-row"
                  href={`/comercial/${a.agent.id}${periodQuery(from, to)}`}
                >
                  <Avatar agent={a.agent} live={a.live} />
                  <div className="grow">
                    <div className="name">{a.agent.name}</div>
                    <div className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <StatusDot live={a.live} />
                      {l.text}
                    </div>
                  </div>
                  <div className="right">
                    <b className="num">{fmtInt(a.today.llamadas)}</b>
                    hoy · {fmtDuration(a.today.tiempo_llamada)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
