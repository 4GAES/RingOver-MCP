import { useRef } from "react";
import type { Timeline as TimelineData } from "../../shared/api";
import { fmtDuration, fmtPhone } from "../../shared/format";
import { localSecondOfDay, localToUtc } from "../../shared/time";
import { useWidth } from "../lib/hooks";
import { TipRow, useTooltip } from "./tooltip";

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });

/**
 * La jornada de un comercial en una línea de tiempo: arriba, cuándo estuvo conectado
 * a Ringover (rayado = no molestar); abajo, cada llamada en su hora real con su
 * duración (azul = nueva, naranja = antigua, trazo fino = sin respuesta).
 */
export function Timeline({ data, now }: { data: TimelineData; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const tip = useTooltip();

  const firstMs = Math.min(
    ...data.calls.map((c) => c.startMs),
    ...data.segments.map((s) => s.startMs),
    localToUtc(data.day, 9 * 3600),
  );
  const lastMs = Math.max(
    ...data.calls.map((c) => c.endMs),
    ...data.segments.map((s) => s.endMs),
    // La jornada se dibuja al menos hasta las 19 h, también hoy: se ve lo que queda de día.
    localToUtc(data.day, 19 * 3600),
  );
  const startH = Math.floor(localSecondOfDay(firstMs) / 3600);
  const endH = Math.min(
    24,
    Math.ceil(localSecondOfDay(lastMs - 1) / 3600) + (lastMs > localToUtc(data.day, 23 * 3600) ? 1 : 0),
  );
  const t0 = localToUtc(data.day, startH * 3600);
  const t1 = localToUtc(data.day, Math.max(startH + 1, endH) * 3600);

  const m = { left: 76, right: 12, top: 8 };
  const innerW = Math.max(40, w - m.left - m.right);
  const x = (ms: number) => ((Math.min(Math.max(ms, t0), t1) - t0) / (t1 - t0)) * innerW;
  const laneConn = { y: 10, h: 12 };
  const laneCalls = { y: 44, h: 36 };
  const height = 112;
  const hours: number[] = [];
  for (let h = startH; h <= Math.max(startH + 1, endH); h++) hours.push(h);
  const step = innerW / hours.length < 42 ? 2 : 1;
  const showNow = now > t0 && now < t1;

  return (
    <div ref={ref} className="chart timeline">
      <svg
        width={w}
        height={height}
        role="img"
        aria-label={`Jornada del ${data.day}: ${data.calls.length} llamadas`}
      >
        <defs>
          <pattern
            id="hatch"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="5" height="5" fill="var(--wash)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hatch)" strokeWidth="2" />
          </pattern>
        </defs>
        <text className="lane-label" x={0} y={m.top + laneConn.y + laneConn.h / 2} dy="0.32em">
          Conectado
        </text>
        <text className="lane-label" x={0} y={m.top + laneCalls.y + laneCalls.h / 2} dy="0.32em">
          Llamadas
        </text>
        <g transform={`translate(${m.left},${m.top})`}>
          {hours.map((h, i) => {
            const hx = (i * innerW) / (hours.length - 1);
            return (
              <g key={h} transform={`translate(${hx},0)`}>
                <line className="gridline" y1={0} y2={laneCalls.y + laneCalls.h} />
                {i % step === 0 ? (
                  <text className="tick" y={laneCalls.y + laneCalls.h + 18} textAnchor="middle">
                    {String(h).padStart(2, "0")}:00
                  </text>
                ) : null}
              </g>
            );
          })}
          <rect x={0} y={laneConn.y} width={innerW} height={laneConn.h} rx={3} fill="var(--surface-2)" />
          {data.segments.map((s) => {
            const sx = x(s.startMs);
            const sw = Math.max(2, x(s.endMs) - sx);
            return (
              <rect
                key={s.startMs}
                x={sx}
                y={laneConn.y}
                width={sw}
                height={laneConn.h}
                rx={3}
                fill={s.snoozed ? "url(#hatch)" : "var(--ink-3)"}
                opacity={s.snoozed ? 1 : 0.38}
                onPointerMove={(e) =>
                  tip.show(
                    e.clientX,
                    e.clientY,
                    <>
                      <div className="t-title">{s.snoozed ? "No molestar" : "Conectado"}</div>
                      <TipRow
                        label={`${hhmm(s.startMs)} – ${hhmm(s.endMs)}`}
                        value={fmtDuration((s.endMs - s.startMs) / 1000)}
                      />
                    </>,
                  )
                }
                onPointerLeave={tip.hide}
              />
            );
          })}
          <line
            className="baseline"
            x1={0}
            x2={innerW}
            y1={laneCalls.y + laneCalls.h}
            y2={laneCalls.y + laneCalls.h}
          />
          {data.calls.map((c) => {
            const cx = x(c.startMs);
            const cw = Math.max(c.answered ? 3 : 1.5, x(c.endMs) - cx);
            const answered = c.answered;
            const h = answered ? laneCalls.h : laneCalls.h * 0.42;
            const color = c.isNew ? "var(--nueva)" : "var(--antigua)";
            const phone = fmtPhone(c.number);
            return (
              <g key={c.id}>
                <rect
                  x={cx}
                  y={laneCalls.y + laneCalls.h - h}
                  width={cw}
                  height={h}
                  rx={answered && cw > 6 ? 2 : 0.5}
                  fill={answered ? color : "var(--ink-3)"}
                  opacity={answered ? 1 : 0.55}
                />
                <rect
                  className="hit"
                  x={cx - 3}
                  y={laneCalls.y - 4}
                  width={cw + 6}
                  height={laneCalls.h + 8}
                  onPointerMove={(e) =>
                    tip.show(
                      e.clientX,
                      e.clientY,
                      <>
                        <div className="t-title">
                          {hhmm(c.startMs)} · {c.direction === "in" ? "Entrante" : "Saliente"}
                        </div>
                        <TipRow
                          label={`${phone.flag} ${phone.pretty}`}
                          value={c.isNew ? "Nueva" : "Antigua"}
                        />
                        <TipRow
                          label="Conversación"
                          value={answered ? fmtDuration(c.talk) : "Sin respuesta"}
                        />
                        {c.contactName ? <p>{c.contactName}</p> : null}
                      </>,
                    )
                  }
                  onPointerLeave={tip.hide}
                />
              </g>
            );
          })}
          {showNow ? (
            <g transform={`translate(${x(now)},0)`}>
              <line
                y1={laneConn.y - 6}
                y2={laneCalls.y + laneCalls.h}
                stroke="var(--accent)"
                strokeWidth={1.5}
              />
              <circle cy={laneConn.y - 6} r={3} fill="var(--accent)" />
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  );
}
