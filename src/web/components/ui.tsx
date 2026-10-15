import type { ReactNode } from "react";
import type { AgentRef, LiveState } from "../../shared/api";
import { fmtDelta, fmtDuration, fmtInt } from "../../shared/format";
import { delta, type MetricDef, type Polarity } from "../../shared/metrics";
import { IconDown, IconInfo, IconUp } from "./icons";
import { useTooltip } from "./tooltip";

export function Avatar({ agent, live, size }: { agent: AgentRef; live?: LiveState | null; size?: "lg" }) {
  return (
    <span
      className={`avatar${size ? ` ${size}` : ""}`}
      style={{ background: agent.color ?? "var(--ink-3)" }}
      aria-hidden="true"
    >
      {agent.initials}
      {live ? <StatusDot live={live} /> : null}
    </span>
  );
}

export function liveLabel(l: LiveState | null | undefined, now: number): { text: string; cls: string } {
  if (!l || !l.fresh) return { text: "Sin datos de conexión", cls: "" };
  const mins = Math.max(1, Math.round((now - l.sinceMs) / 60_000));
  const since = mins < 60 ? `${mins} min` : fmtDuration(mins * 60);
  if (!l.connected) return { text: "Desconectado", cls: "" };
  if (l.inCall) return { text: `En llamada · ${since}`, cls: "call" };
  if (l.snoozed) return { text: `No molestar · ${since}`, cls: "dnd" };
  return { text: `Disponible · ${since}`, cls: "ok" };
}

export function StatusDot({ live }: { live: LiveState | null | undefined }) {
  const cls = !live?.fresh || !live.connected ? "" : live.inCall ? "call pulse" : live.snoozed ? "dnd" : "ok";
  return <span className={`dot ${cls}`} />;
}

/** Color de la variación según si subir es bueno, malo o depende. */
export function deltaClass(d: number | null, up: Polarity): string {
  if (d === null || Math.abs(d) < 0.005) return "flat";
  if (up === null) return "";
  return d > 0 === up ? "good" : "bad";
}

export function Delta({
  cur,
  prev,
  def,
  prevLabel,
}: {
  cur: number | null;
  prev: number | null;
  def: MetricDef;
  prevLabel: string;
}) {
  const tip = useTooltip();
  const d = delta(cur, prev);
  const cls = deltaClass(d, def.upIsGood);
  const prevText = prev === null ? "sin dato" : def.kind === "duration" ? fmtDuration(prev) : fmtInt(prev);
  const describe = d === null ? "sin comparación" : `${fmtDelta(d)} frente a ${prevLabel}`;
  return (
    <span
      className={`delta ${cls}`}
      role="img"
      aria-label={describe}
      onPointerEnter={(e) =>
        tip.showAt(
          e.currentTarget,
          <>
            <div className="t-title">{prevLabel}</div>
            <p>
              {def.short}: <b>{prevText}</b>
            </p>
          </>,
        )
      }
      onPointerLeave={tip.hide}
    >
      {d === null ? (
        "—"
      ) : (
        <>
          {d > 0.005 ? <IconUp /> : d < -0.005 ? <IconDown /> : null}
          {fmtDelta(d)}
        </>
      )}
    </span>
  );
}

export function InfoTip({ title, children }: { title: string; children: ReactNode }) {
  const tip = useTooltip();
  const open = (el: Element) =>
    tip.showAt(
      el,
      <>
        <div className="t-title">{title}</div>
        <p>{children}</p>
      </>,
    );
  return (
    <button
      type="button"
      className="info"
      aria-label={`Qué es: ${title}`}
      onPointerEnter={(e) => open(e.currentTarget)}
      onPointerLeave={tip.hide}
      onFocus={(e) => open(e.currentTarget)}
      onBlur={tip.hide}
    >
      <IconInfo />
    </button>
  );
}

/** "4 h 12 min" con las unidades más pequeñas que los números. */
export function DurationValue({ seconds }: { seconds: number }) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0)
    return (
      <>
        {h}
        <span className="unit">h</span> {m}
        <span className="unit">min</span>
      </>
    );
  if (m > 0)
    return (
      <>
        {m}
        <span className="unit">min</span>
        {m < 10 && r > 0 ? (
          <>
            {" "}
            {r}
            <span className="unit">s</span>
          </>
        ) : null}
      </>
    );
  return (
    <>
      {r}
      <span className="unit">s</span>
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Skeleton({ h, w = "100%", r }: { h: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}
