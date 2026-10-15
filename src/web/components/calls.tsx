import { useEffect } from "react";
import type { CallItem } from "../../shared/api";
import { capitalize, fmtDayShort, fmtDuration, fmtPhone } from "../../shared/format";
import { LARGA_S } from "../../shared/metrics";
import { localDay } from "../../shared/time";
import { useNumber } from "../lib/api";
import { IconPhoneIn, IconPhoneMissed, IconPhoneOut, IconPlay, IconX } from "./icons";
import { Empty, Skeleton } from "./ui";

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });

const STATES: Record<string, string> = {
  ANSWERED: "Contestada",
  CANCELLED: "Cancelada",
  FAILED: "Fallida",
  MISSED: "Perdida",
  UNANSWERED: "Sin respuesta",
  VOICEMAIL: "Buzón de voz",
  QUEUE_TIMEOUT: "Tiempo de cola agotado",
  BLIND_TRANSFERED: "Transferida",
};

export function DirIcon({ c }: { c: Pick<CallItem, "direction" | "answered"> }) {
  const missed = c.direction === "in" && !c.answered;
  return (
    <span
      className={`dir${missed ? " missed" : ""}`}
      title={missed ? "Entrante perdida" : c.direction === "in" ? "Entrante" : "Saliente"}
    >
      {missed ? <IconPhoneMissed /> : c.direction === "in" ? <IconPhoneIn /> : <IconPhoneOut />}
    </span>
  );
}

export function TypeChip({ isNew }: { isNew: boolean }) {
  return (
    <span className="chip">
      <i style={{ background: isNew ? "var(--nueva)" : "var(--antigua)" }} />
      {isNew ? "Nueva" : "Antigua"}
    </span>
  );
}

export function CallsTable({
  items,
  showAgent = true,
  onNumber,
}: {
  items: CallItem[];
  showAgent?: boolean;
  onNumber: (n: string) => void;
}) {
  if (items.length === 0) return <Empty title="No hay llamadas con estos filtros" />;
  const today = localDay(Date.now());
  return (
    <div className="table-scroll">
      <table className="data calls">
        <thead>
          <tr>
            <th>Hora</th>
            {showAgent ? <th>Comercial</th> : null}
            <th>Contacto</th>
            <th>Tipo</th>
            <th>Resultado</th>
            <th className="r">Conversación</th>
            <th className="r" aria-label="Grabación" />
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const ph = fmtPhone(c.number);
            const day = localDay(c.startMs);
            return (
              <tr key={c.id}>
                <td>
                  <span className="num">{time(c.startMs)}</span>
                  {day !== today ? <span className="muted"> · {fmtDayShort(day)}</span> : null}
                </td>
                {showAgent ? <td>{c.agent?.name ?? "—"}</td> : null}
                <td>
                  <span className="contact">
                    <DirIcon c={c} />
                    <span className="flag" aria-hidden="true">
                      {ph.flag}
                    </span>
                    {c.number ? (
                      <button
                        type="button"
                        onClick={() => onNumber(c.number as string)}
                        aria-label={`${ph.pretty}: ver todas las llamadas con este número`}
                      >
                        {ph.pretty}
                      </button>
                    ) : (
                      <span className="muted">{ph.pretty}</span>
                    )}
                    {c.contactName ? <span className="muted">{c.contactName}</span> : null}
                  </span>
                </td>
                <td>
                  <TypeChip isNew={c.isNew} />
                </td>
                <td className={c.answered ? undefined : "muted"}>
                  {STATES[c.state ?? ""] ?? capitalize((c.state ?? "—").toLowerCase())}
                </td>
                <td className="r num">
                  {c.answered ? (
                    c.talk >= LARGA_S ? (
                      <span className="chip long">{fmtDuration(c.talk)}</span>
                    ) : (
                      fmtDuration(c.talk)
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="r">
                  {c.record ? (
                    <a
                      className="icon-btn"
                      href={c.record}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label="Escuchar la grabación"
                    >
                      <IconPlay />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Panel lateral con todo lo hablado con un número. */
export function NumberDrawer({ number, onClose }: { number: string | null; onClose: () => void }) {
  const q = useNumber(number);
  useEffect(() => {
    if (!number) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [number, onClose]);
  if (!number) return null;
  const ph = fmtPhone(number);
  const h = q.data;
  return (
    <>
      <div className="drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Historial de ${ph.pretty}`}>
        <header>
          <div style={{ flex: 1 }}>
            <h2>
              {ph.flag} {ph.pretty}
            </h2>
            <p>
              {h
                ? `${h.calls.length} llamada${h.calls.length === 1 ? "" : "s"} · ${
                    h.firstTalkMs
                      ? `primera conversación el ${fmtDayShort(localDay(h.firstTalkMs))} a las ${time(h.firstTalkMs)}`
                      : "nunca ha contestado"
                  }`
                : "Cargando…"}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconX />
          </button>
        </header>
        <div className="body">
          {q.isLoading ? (
            <div style={{ padding: 20, display: "grid", gap: 10 }}>
              <Skeleton h={40} />
              <Skeleton h={40} />
              <Skeleton h={40} />
            </div>
          ) : (
            h?.calls.map((c) => (
              <div key={c.id} className="hist-row">
                <DirIcon c={c} />
                <div>
                  <div className="when">
                    {capitalize(fmtDayShort(localDay(c.startMs)))} · {time(c.startMs)}
                  </div>
                  <div className="sub">
                    {c.agent?.name ?? "—"} ·{" "}
                    {c.answered ? fmtDuration(c.talk) : (STATES[c.state ?? ""] ?? "Sin respuesta")}
                  </div>
                </div>
                <TypeChip isNew={c.isNew} />
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
