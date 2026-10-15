import { useEffect, useState } from "react";
import { CallsTable, NumberDrawer } from "../components/calls";
import { IconSearch } from "../components/icons";
import { PeriodBar } from "../components/period-bar";
import { Skeleton } from "../components/ui";
import { useCalls } from "../lib/api";
import { usePeriod } from "../lib/period";
import { setParams, useLocation } from "../lib/router";
import { useSelection } from "../lib/selection";

export function CallsPage() {
  const p = usePeriod();
  const { search } = useLocation();
  const sel = useSelection();
  const filters = {
    comerciales: sel.key,
    tipo: search.get("tipo"),
    resultado: search.get("resultado"),
    duracion: search.get("duracion"),
    numero: search.get("numero"),
  };
  const [text, setText] = useState(filters.numero ?? "");
  const [number, setNumber] = useState<string | null>(null);
  const q = useCalls({ from: p.from, to: p.to, ...filters });

  // Enlaces antiguos con un solo comercial (?comercial=101) pasan a la selección.
  const legacy = search.get("comercial");
  useEffect(() => {
    if (legacy && /^\d+$/.test(legacy))
      setParams({ comercial: null, comerciales: legacy }, { replace: true });
  }, [legacy]);
  const items = q.data?.pages.flatMap((pg) => pg.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  // Búsqueda por número con una pequeña espera para no lanzar una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.numero ?? "") !== text) setParams({ numero: text || null });
    }, 300);
    return () => clearTimeout(t);
  }, [text, filters.numero]);

  const select = (key: string, value: string | null, options: [string, string][], label: string) => (
    <select
      className="select"
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => setParams({ [key]: e.target.value || null })}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PeriodBar picker />
      <div className="card">
        <div className="filters">
          {select(
            "tipo",
            filters.tipo,
            [
              ["", "Nuevas y antiguas"],
              ["nuevas", "Solo nuevas"],
              ["antiguas", "Solo antiguas"],
            ],
            "Tipo",
          )}
          {select(
            "resultado",
            filters.resultado,
            [
              ["", "Cualquier resultado"],
              ["contestadas", "Contestadas"],
              ["no_contestadas", "No contestadas"],
            ],
            "Resultado",
          )}
          {select(
            "duracion",
            filters.duracion,
            [
              ["", "Cualquier duración"],
              ["menos5", "Menos de 5 min"],
              ["entre5y15", "De 5 a 15 min"],
              ["mas15", "15 min o más"],
            ],
            "Duración",
          )}
          <label className="search">
            <IconSearch />
            <input
              className="input"
              type="search"
              inputMode="tel"
              placeholder="Buscar teléfono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Buscar por teléfono"
            />
          </label>
          <span className="count num">
            {q.data ? `${total.toLocaleString("es-ES")} llamada${total === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        {!q.data ? (
          <div style={{ padding: 20, display: "grid", gap: 12 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} h={22} />
            ))}
          </div>
        ) : (
          <div className={`loading-frame${q.isPlaceholderData ? " stale" : ""}`}>
            <CallsTable items={items} onNumber={setNumber} />
            {q.hasNextPage ? (
              <div className="load-more">
                <button
                  type="button"
                  className="btn"
                  onClick={() => q.fetchNextPage()}
                  disabled={q.isFetchingNextPage}
                >
                  {q.isFetchingNextPage ? "Cargando…" : "Ver más"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <NumberDrawer number={number} onClose={() => setNumber(null)} />
    </>
  );
}
