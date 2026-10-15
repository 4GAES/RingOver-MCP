import { type PointerEvent, type ReactNode, useRef } from "react";
import { useWidth } from "../lib/hooks";
import { TipRow, useTooltip } from "./tooltip";

/** Escala "bonita": máximo redondeado y marcas en múltiplos enteros de 1, 2 o 5. */
export function niceScale(max: number, count = 4): { top: number; ticks: number[] } {
  if (max <= 0) return { top: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { top, ticks };
}

/** Rectángulo con las esquinas superiores redondeadas (extremo de dato) y base recta. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ── Minigráfico de tendencia ────────────────────────────────────────────────
export function Sparkline({
  values,
  labels,
  format,
  height = 30,
}: {
  values: (number | null)[];
  labels: string[];
  format: (v: number | null) => string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref, 220);
  const tip = useTooltip();
  const hoverRef = useRef<SVGGElement>(null);
  const n = values.length;
  const nums = values.filter((v): v is number => v !== null);
  if (n < 2 || nums.length === 0) return <div ref={ref} style={{ height }} />;

  const max = Math.max(...nums, 1);
  const pad = 4;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (n - 1);
  const y = (v: number) => pad + (height - pad * 2) * (1 - v / max);

  let line = "";
  let area = "";
  let runStart = -1;
  values.forEach((v, i) => {
    if (v === null) {
      if (runStart >= 0) area += `L${x(i - 1)},${height}L${x(runStart)},${height}Z`;
      runStart = -1;
      return;
    }
    const cmd = runStart < 0 ? "M" : "L";
    line += `${cmd}${x(i)},${y(v)}`;
    area += `${cmd}${x(i)},${y(v)}`;
    if (runStart < 0) runStart = i;
    if (i === n - 1) area += `L${x(i)},${height}L${x(runStart)},${height}Z`;
  });
  const last = values[n - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(
      0,
      Math.min(n - 1, Math.round(((e.clientX - r.left - pad) / (w - pad * 2)) * (n - 1))),
    );
    const v = values[i] ?? null;
    const g = hoverRef.current;
    if (g) {
      g.style.opacity = "1";
      g.setAttribute("transform", `translate(${x(i)},0)`);
      const c = g.querySelector("circle");
      if (c) {
        c.setAttribute("cy", String(v === null ? -99 : y(v)));
      }
    }
    tip.show(e.clientX, r.top, <TipRow label={labels[i] ?? ""} value={format(v)} />);
  };
  const onLeave = () => {
    if (hoverRef.current) hoverRef.current.style.opacity = "0";
    tip.hide();
  };

  return (
    <div ref={ref} className="chart" style={{ height }}>
      <svg
        width={w}
        height={height}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        role="img"
        aria-label="Tendencia"
      >
        <path d={area} fill="var(--ink-3)" opacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last !== null && last !== undefined ? (
          <circle
            cx={x(n - 1)}
            cy={y(last)}
            r={3.5}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ) : null}
        <g ref={hoverRef} style={{ opacity: 0, pointerEvents: "none" }}>
          <line y1={0} y2={height} stroke="var(--axis)" strokeWidth={1} />
          <circle r={3.5} cx={0} cy={-99} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />
        </g>
      </svg>
    </div>
  );
}

// ── Columnas (apiladas o simples) ───────────────────────────────────────────
export interface ColumnDatum {
  key: string;
  label: string;
  title: string;
  values: number[];
  highlight?: boolean;
  /** Color propio de la columna (series de una sola serie con tramos). */
  color?: string;
}

export function Columns({
  data,
  series,
  height = 220,
  ariaLabel,
  formatTotal,
  footer,
  sparseLabels = false,
}: {
  data: ColumnDatum[];
  /** Las etiquetas vienen ya espaciadas (solo algunas columnas tienen texto). */
  sparseLabels?: boolean;
  series: { label: string; color: string }[];
  height?: number;
  ariaLabel: string;
  formatTotal?: (d: ColumnDatum, total: number) => ReactNode;
  footer?: (d: ColumnDatum) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref);
  const tip = useTooltip();
  const m = { top: 10, right: 4, bottom: 24, left: 34 };
  const innerW = Math.max(10, w - m.left - m.right);
  const innerH = height - m.top - m.bottom;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const { top, ticks } = niceScale(Math.max(...totals, 0));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(24, band * 0.64));
  const y = (v: number) => (innerH * v) / top;
  const labelEvery = Math.max(1, Math.ceil(40 / band));

  const showTip = (e: PointerEvent<SVGRectElement>, d: ColumnDatum, total: number) => {
    tip.show(
      e.clientX,
      e.clientY,
      <>
        <div className="t-title">{d.title}</div>
        {series.length > 1
          ? series.map((s, i) => (
              <TipRow key={s.label} color={s.color} label={s.label} value={d.values[i] ?? 0} />
            ))
          : null}
        {formatTotal ? formatTotal(d, total) : <TipRow label="Total" value={total} />}
      </>,
    );
  };

  return (
    <div ref={ref} className="chart">
      <svg width={w} height={height} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${innerH - y(t)})`}>
              {t > 0 ? <line className="gridline" x1={0} x2={innerW} /> : null}
              <text className="tick" x={-8} dy="0.32em" textAnchor="end">
                {t.toLocaleString("es-ES")}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = band * i + band / 2;
            const x0 = cx - barW / 2;
            let acc = 0;
            const segs = d.values.map((v, si) => ({ v, si })).filter((s) => s.v > 0);
            return (
              <g key={d.key}>
                {d.highlight ? (
                  <rect
                    x={band * i + 1}
                    y={-m.top}
                    width={band - 2}
                    height={innerH + m.top}
                    rx={6}
                    fill="var(--wash)"
                  />
                ) : null}
                {segs.map((s, k) => {
                  const h = y(s.v);
                  const yTop = innerH - y(acc) - h;
                  acc += s.v;
                  const isTop = k === segs.length - 1;
                  // 2 px de hueco entre tramos apilados (el color de fondo hace de separador).
                  const gap = k > 0 ? 2 : 0;
                  const hh = Math.max(0, h - gap);
                  const color = d.color ?? series[s.si]?.color ?? "var(--accent)";
                  return isTop ? (
                    <path key={s.si} className="col" d={topRounded(x0, yTop, barW, hh, 4)} fill={color} />
                  ) : (
                    <rect key={s.si} className="col" x={x0} y={yTop} width={barW} height={hh} fill={color} />
                  );
                })}
                {d.label && (sparseLabels || i % labelEvery === 0 || d.highlight) ? (
                  <text
                    className="tick"
                    x={cx}
                    y={innerH + 16}
                    textAnchor="middle"
                    fontWeight={d.highlight ? 600 : 400}
                  >
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="baseline" x1={0} x2={innerW} y1={innerH} y2={innerH} />
          {data.map((d, i) => (
            <rect
              key={`hit-${d.key}`}
              className="hit"
              x={band * i}
              y={0}
              width={band}
              height={innerH}
              onPointerMove={(e) => showTip(e, d, totals[i] ?? 0)}
              onPointerLeave={tip.hide}
            />
          ))}
        </g>
      </svg>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={d.key}>
              <th>{d.title}</th>
              {d.values.map((v, si) => (
                <td key={series[si]?.label ?? si}>{v}</td>
              ))}
              <td>{totals[i]}</td>
              {footer ? <td>{footer(d)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
