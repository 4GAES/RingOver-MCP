import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

// Un único tooltip para toda la app: los gráficos solo le pasan contenido y posición.
interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

interface TipApi {
  show: (x: number, y: number, content: ReactNode) => void;
  showAt: (el: Element, content: ReactNode) => void;
  hide: () => void;
}

const Ctx = createContext<TipApi | null>(null);

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const show = useCallback((x: number, y: number, content: ReactNode) => setTip({ x, y, content }), []);
  const showAt = useCallback((el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const api = useMemo(() => ({ show, showAt, hide }), [show, showAt, hide]);

  // Se coloca encima del puntero; si no cabe, debajo; nunca se sale de la pantalla.
  let style: React.CSSProperties = { opacity: 0, left: -9999, top: 0 };
  if (tip) {
    const w = ref.current?.offsetWidth ?? 180;
    const h = ref.current?.offsetHeight ?? 60;
    let left = tip.x + 14;
    if (left + w > window.innerWidth - 8) left = tip.x - w - 14;
    let top = tip.y - h - 12;
    if (top < 8) top = tip.y + 18;
    style = { left: Math.max(8, left), top, opacity: 1 };
  }

  return (
    <Ctx.Provider value={api}>
      {children}
      <div ref={ref} className="tooltip" role="tooltip" style={style} aria-hidden={!tip}>
        {tip?.content}
      </div>
    </Ctx.Provider>
  );
}

export function useTooltip(): TipApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useTooltip fuera de TooltipProvider");
  return api;
}

export function TipRow({ color, label, value }: { color?: string; label: string; value: ReactNode }) {
  return (
    <div className="t-row">
      {color ? <span className="key" style={{ background: color }} /> : null}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
