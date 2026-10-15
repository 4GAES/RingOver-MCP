import { useMemo, useRef, useState } from "react";
import type { CompareInfo } from "../../shared/api";
import { capitalize, fmtDayLong, fmtRange } from "../../shared/format";
import { useDismiss, useHotkeys } from "../lib/hooks";
import { PRESETS, usePeriod } from "../lib/period";
import { AgentPicker } from "./agent-picker";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "./icons";

/** Periodo (y, con `picker`, la selección de comerciales) en una sola fila sobre los datos. */
export function PeriodBar({ compare, picker = false }: { compare?: CompareInfo | null; picker?: boolean }) {
  const p = usePeriod();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: p.from, to: p.to });
  const popRef = useRef<HTMLDivElement>(null);
  useDismiss(popRef, open, () => setOpen(false));

  const keys = useMemo(
    () => ({
      ArrowLeft: () => p.step(-1),
      ArrowRight: () => p.step(1),
      h: () => p.setPreset("hoy"),
    }),
    [p],
  );
  useHotkeys(keys);

  const compareText = compare
    ? `Comparado con ${fmtRange(compare.from, compare.to)}${
        compare.partial
          ? ` hasta las ${new Date(compare.endMs).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}`
          : ""
      } · ${compare.label}`
    : "";

  return (
    <div className="period-bar">
      <div className="segmented" role="group" aria-label="Periodo">
        {PRESETS.map((pr) => (
          <button
            key={pr.key}
            type="button"
            aria-pressed={p.preset === pr.key}
            onClick={() => p.setPreset(pr.key)}
          >
            {pr.label}
          </button>
        ))}
      </div>

      {p.single ? (
        <div className="stepper">
          <button
            type="button"
            className="icon-btn"
            onClick={() => p.step(-1)}
            aria-label="Día anterior"
            title="Día anterior (←)"
          >
            <IconChevronLeft />
          </button>
          <span className="label" aria-live="polite">
            {capitalize(fmtDayLong(p.from))}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => p.step(1)}
            disabled={p.from >= p.today}
            aria-label="Día siguiente"
            title="Día siguiente (→)"
          >
            <IconChevronRight />
          </button>
        </div>
      ) : (
        <div className="stepper">
          <span className="label">{capitalize(fmtRange(p.from, p.to))}</span>
        </div>
      )}

      <div className="pop-anchor" ref={popRef}>
        <button
          type="button"
          className="btn"
          aria-pressed={!p.preset}
          aria-expanded={open}
          onClick={() => {
            setDraft({ from: p.from, to: p.to });
            setOpen((o) => !o);
          }}
        >
          <IconCalendar /> Fechas
        </button>
        {open ? (
          <form
            className="popover left range-pop"
            onSubmit={(e) => {
              e.preventDefault();
              const from = draft.from <= draft.to ? draft.from : draft.to;
              const to = draft.from <= draft.to ? draft.to : draft.from;
              p.setRange(from, to);
              setOpen(false);
            }}
          >
            <div className="pop-head" style={{ padding: "0 0 4px" }}>
              Elige un día o un rango
            </div>
            <div className="fields">
              <label className="field">
                Desde
                <input
                  className="input"
                  type="date"
                  value={draft.from}
                  max={p.today}
                  required
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                />
              </label>
              <label className="field">
                Hasta
                <input
                  className="input"
                  type="date"
                  value={draft.to}
                  max={p.today}
                  required
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                />
              </label>
            </div>
            <button type="submit" className="btn primary" style={{ width: "100%" }}>
              Ver periodo
            </button>
          </form>
        ) : null}
      </div>

      {picker ? <AgentPicker /> : null}

      {compareText ? <span className="compare-note">{compareText}</span> : null}
    </div>
  );
}
