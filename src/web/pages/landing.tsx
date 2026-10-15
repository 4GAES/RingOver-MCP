import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Timeline as TimelineData } from "../../shared/api";
import { COMPANY } from "../../shared/legal";
import { GROUPS, METRICS } from "../../shared/metrics";
import { localDay, localToUtc } from "../../shared/time";
import { BrandLogo, BrandMarkLogo } from "../components/brand";
import { Columns, Sparkline } from "../components/charts";
import { CookieNotice } from "../components/cookie-notice";
import { SiteFooter } from "../components/footer";
import { IconMoon, IconSun } from "../components/icons";
import { SiteHeader } from "../components/site-header";
import { Timeline } from "../components/timeline";
import { TooltipProvider } from "../components/tooltip";
import { useCreateLead } from "../lib/api";
import { FAQ, HOW_IT_WORKS } from "./landing-content";
import { LoginModal, takeLoginError } from "./login";

// Landing pública del producto para equipos que usan Ringover. Todo lo que se ve aquí es
// de EJEMPLO: ningún dato real sale sin iniciar sesión. El acceso está en la cabecera.
// Se renderiza también en el servidor (scripts/prerender.tsx): nada de window en el render.

const isBrowser = typeof window !== "undefined";

// ── Datos de ejemplo (deterministas) ─────────────────────────────────────────
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const SPARK = {
  llamadas: [96, 118, 104, 131, 0, 0, 122, 128, 115, 139, 126, 0, 0, 142],
  hablado: [4.1, 5.2, 4.6, 5.8, 0, 0, 5.1, 5.5, 4.9, 6.2, 5.6, 0, 0, 5.9],
  largas: [3, 6, 4, 7, 0, 0, 5, 6, 4, 9, 6, 0, 0, 10],
};
const NEW_BY_HOUR = [2, 14, 19, 17, 15, 9, 5, 11, 16, 15, 12, 7, 2];
const OLD_BY_HOUR = [1, 5, 7, 8, 6, 4, 2, 5, 7, 8, 6, 3, 1];
const HOURS = NEW_BY_HOUR.map((n, i) => ({
  key: String(8 + i),
  label: `${8 + i}h`,
  title: `De ${8 + i}:00 a ${9 + i}:00`,
  values: [n, OLD_BY_HOUR[i] as number],
}));

function demoDay(): TimelineData {
  const day = localDay(Date.now());
  const at = (h: number, m = 0) => localToUtc(day, h * 3600 + m * 60);
  seed = 11;
  const calls: TimelineData["calls"] = [];
  let t = at(9, 12);
  let id = 1;
  while (t < at(19, 30)) {
    if (t > at(14, 5) && t < at(15, 5)) t = at(15, 8);
    const answered = rnd() < 0.58;
    const talk = answered ? Math.round(rnd() < 0.12 ? 900 + rnd() * 900 : 30 + rnd() * 380) : 0;
    const dur = (answered ? talk + 8 : 18 + rnd() * 20) * 1000;
    calls.push({
      id: id++,
      startMs: t,
      endMs: t + dur,
      answered,
      isNew: rnd() < 0.62,
      talk,
      direction: "out",
      number: null,
      contactName: answered ? "Lead de ejemplo" : null,
    });
    t += dur + (2 + rnd() * 9) * 60_000;
  }
  return {
    day,
    startMs: at(0),
    endMs: at(23, 59),
    segments: [
      { startMs: at(9, 2), endMs: at(12, 10), snoozed: false },
      { startMs: at(12, 10), endMs: at(12, 32), snoozed: true },
      { startMs: at(12, 32), endMs: at(14, 4), snoozed: false },
      { startMs: at(15, 3), endMs: at(19, 41), snoozed: false },
    ],
    calls,
  };
}

// ── Utilidades de animación ──────────────────────────────────────────────────
const reduced = () => isBrowser && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Aparece al entrar en pantalla (una sola vez). */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`reveal${inView ? " in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Contador que sube hasta el valor al aparecer (en el HTML del servidor ya va el valor final). */
function CountUp({
  to,
  format = (n: number) => n.toLocaleString("es-ES"),
}: {
  to: number;
  format?: (n: number) => string;
}) {
  const [v, setV] = useState(to);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reduced()) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    setV(0);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        // El primer frame puede llegar con una marca anterior a t0: sin el max, saldría negativo.
        const p = Math.min(1, Math.max(0, (now - t0) / 1200));
        setV(to * (1 - (1 - p) ** 3));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return <span ref={ref}>{format(v >= to ? to : Math.round(v))}</span>;
}

/** Texto que se escribe solo (la respuesta de la IA en el ejemplo). */
function Typewriter({ text, start }: { text: string; start: boolean }) {
  const [n, setN] = useState(text.length);
  useEffect(() => {
    if (reduced()) return;
    setN(0);
  }, []);
  useEffect(() => {
    if (!start || reduced()) return;
    const id = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(id), x) : x + 2)), 16);
    return () => clearInterval(id);
  }, [start, text]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length ? <span className="caret" /> : null}
    </>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export function Landing() {
  const [initialError] = useState(() => (isBrowser ? takeLoginError() : null));
  const [connecting] = useState(() =>
    isBrowser ? new URLSearchParams(location.search).get("conectar") : null,
  );
  // El acceso se abre solo si vienes de un error, de conectar una IA, de un enlace del panel
  // o de «Entrar» en otra página (/#entrar).
  const [loginOpen, setLoginOpen] = useState(
    () =>
      isBrowser &&
      Boolean(initialError || connecting || location.pathname !== "/" || location.hash === "#entrar"),
  );
  const heroRef = useRef<HTMLElement>(null);
  const day = useMemo(demoDay, []);

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <TooltipProvider>
      <div className="lp">
        <SiteHeader home onLogin={() => setLoginOpen(true)} />

        <main>
          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <section className="lp-hero" ref={heroRef} onPointerMove={onMove}>
            <div className="lp-hero-bg" aria-hidden="true" />
            <div className="lp-wrap lp-hero-grid">
              <div className="lp-hero-copy">
                <span className="lp-pill">
                  <span className="dot ok pulse" /> Para equipos comerciales que usan Ringover
                </span>
                <h1>
                  <span className="lp-h1-kicker">Analítica de llamadas e IA para Ringover</span>
                  Cada llamada cuenta.
                  <br />
                  <span className="lp-grad">Ahora, también se entiende.</span>
                </h1>
                <p className="lp-sub">
                  Conecta tu Ringover y tu equipo tendrá, en minutos, las métricas que importan por comercial,
                  su jornada en tiempo real, alertas automáticas y una IA (Claude, ChatGPT o Cursor) a la que
                  preguntárselo todo. Un producto de 4Geeks.
                </p>
                <div className="lp-cta">
                  <a className="lp-btn primary" href="#acceso">
                    Solicitar acceso
                  </a>
                  <a className="lp-btn ghost" href="#como-funciona">
                    Ver cómo funciona
                  </a>
                </div>
                <ul className="lp-proof">
                  <li>
                    <b>12 meses</b> de histórico importado
                  </li>
                  <li>
                    <b>15</b> herramientas para tu IA
                  </li>
                  <li>
                    <b>3 min</b> entre sincronizaciones
                  </li>
                </ul>
              </div>

              <div className="lp-hero-visual" role="img" aria-label="Ejemplo del panel con datos inventados">
                <div className="lp-window">
                  <div className="lp-window-bar">
                    <i />
                    <i />
                    <i />
                    <span>Panel · Hoy</span>
                    <em>Datos de ejemplo</em>
                  </div>
                  <div className="lp-window-body">
                    <div className="lp-kpis">
                      <MiniKpi
                        label="Llamadas"
                        value={<CountUp to={142} />}
                        delta="+12 %"
                        spark={SPARK.llamadas}
                      />
                      <MiniKpi
                        label="En llamada"
                        value={
                          <CountUp
                            to={354}
                            format={(n) => `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, "0")} min`}
                          />
                        }
                        delta="+17 %"
                        spark={SPARK.hablado}
                      />
                      <MiniKpi
                        label="+15 min"
                        value={<CountUp to={10} />}
                        delta="+100 %"
                        spark={SPARK.largas}
                      />
                    </div>
                    <div className="lp-chart">
                      <div className="lp-chart-head">
                        <b>Ritmo por hora</b>
                        <span className="legend">
                          <span>
                            <i style={{ background: "var(--nueva)" }} />
                            Nuevas
                          </span>
                          <span>
                            <i style={{ background: "var(--antigua)" }} />
                            Seguimientos
                          </span>
                        </span>
                      </div>
                      <Columns
                        data={HOURS}
                        series={[
                          { label: "Nuevas", color: "var(--nueva)" },
                          { label: "Seguimientos", color: "var(--antigua)" },
                        ]}
                        height={150}
                        ariaLabel="Ejemplo: llamadas por hora"
                      />
                    </div>
                  </div>
                </div>
                <div className="lp-float lp-float-a">
                  <span className="lp-float-ico warn">!</span>
                  <div>
                    <b>Diego lleva 45 min conectado sin llamar</b>
                    <span>Señal del día · hace 2 min</span>
                  </div>
                </div>
                <div className="lp-float lp-float-b">
                  <span className="lp-float-ico ai">✦</span>
                  <div>
                    <b>47 leads calientes sin seguimiento</b>
                    <span>Claude · seguimientos_pendientes</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Integraciones ────────────────────────────────────────────── */}
          <section className="lp-strip" aria-label="Integraciones">
            <div className="lp-wrap lp-strip-row">
              <span>Se conecta con</span>
              <b>Ringover</b>
              <b>Google Workspace</b>
              <b>Claude</b>
              <b>ChatGPT</b>
              <b>Cursor</b>
              <b>Slack</b>
            </div>
          </section>

          {/* ── Cómo funciona ────────────────────────────────────────────── */}
          <section className="lp-section" id="como-funciona">
            <div className="lp-wrap">
              <Reveal>
                <p className="lp-kicker">Cómo funciona</p>
                <h2>De tu cuenta de Ringover a tu panel, en tres pasos</h2>
              </Reveal>
              <ol className="lp-steps">
                {HOW_IT_WORKS.map((s, i) => (
                  <li key={s.title}>
                    <Reveal delay={i * 90} className="lp-step">
                      <span className="lp-step-n">{i + 1}</span>
                      <h3>{s.title}</h3>
                      <p>{s.text}</p>
                    </Reveal>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── Métricas ─────────────────────────────────────────────────── */}
          <section className="lp-section alt" id="producto">
            <div className="lp-wrap">
              <Reveal>
                <p className="lp-kicker">El panel</p>
                <h2>Las 9 métricas de llamadas que de verdad dicen cómo va el día</h2>
                <p className="lp-lead">
                  Volumen, tiempo y calidad de las llamadas de Ringover, por comercial. Cada persona se
                  compara consigo misma, y hoy se compara con el mismo día de la semana pasada hasta la misma
                  hora: nada de sustos a las diez de la mañana.
                </p>
              </Reveal>
              <div className="lp-metrics">
                {GROUPS.map((g, gi) => (
                  <Reveal key={g.key} delay={gi * 90} className="lp-metric-group">
                    <h3>{g.label}</h3>
                    {METRICS.filter((m) => m.group === g.key).map((m) => (
                      <div key={m.key} className="lp-metric">
                        <b>{m.label}</b>
                        <p>{m.definition}</p>
                      </div>
                    ))}
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* ── Jornada ──────────────────────────────────────────────────── */}
          <section className="lp-section" id="jornada">
            <div className="lp-wrap lp-split">
              <Reveal>
                <p className="lp-kicker">La jornada</p>
                <h2>El día de cada comercial, en una sola línea</h2>
                <p className="lp-lead">
                  Cuándo estuvo conectado a Ringover, cuándo en «no molestar» y cada llamada en su hora real:
                  azul las nuevas, naranja los seguimientos. Los huecos se ven solos.
                </p>
                <ul className="lp-checks">
                  <li>Tiempo conectado medido cada minuto</li>
                  <li>Primera y última llamada del día</li>
                  <li>Historial completo de cada número</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <div className="lp-card">
                  <div className="lp-card-head">
                    <span className="lp-avatar">LM</span>
                    <div>
                      <b>Lucía M.</b>
                      <span>
                        <span className="dot call pulse" /> En llamada · 3 min
                      </span>
                    </div>
                    <em>Datos de ejemplo</em>
                  </div>
                  <Timeline data={day} now={Date.now()} />
                </div>
              </Reveal>
            </div>
          </section>

          {/* ── IA ───────────────────────────────────────────────────────── */}
          <section className="lp-section alt" id="ia">
            <div className="lp-wrap lp-split reverse">
              <Reveal>
                <AiDemo />
              </Reveal>
              <Reveal delay={120}>
                <p className="lp-kicker">Pregúntale a tu IA</p>
                <h2>Claude, ChatGPT o Cursor, conectados a tu Ringover</h2>
                <p className="lp-lead">
                  Un servidor MCP con 15 herramientas: resúmenes, alertas, seguimientos pendientes, las
                  mejores horas para llamar o el informe semanal listo para Slack. Del equipo entero, de una
                  persona o del grupo que elijas. Se conecta en un clic, sin copiar tokens.
                </p>
                <ul className="lp-checks">
                  <li>Pregunta por un grupo: «¿cómo van Lucía, Diego y Carla esta semana?»</li>
                  <li>Conector para claude.ai y ChatGPT con la cuenta de cada persona (OAuth)</li>
                  <li>Tokens personales con caducidad para Claude Code y Cursor</li>
                  <li>Registro de cada consulta y consumo por persona</li>
                </ul>
              </Reveal>
            </div>
          </section>

          {/* ── Señales ──────────────────────────────────────────────────── */}
          <section className="lp-section">
            <div className="lp-wrap">
              <Reveal>
                <p className="lp-kicker">Señales</p>
                <h2>Lo importante te encuentra a ti</h2>
              </Reveal>
              <div className="lp-signals">
                <Reveal className="lp-signal" delay={0}>
                  <span className="lp-level alta">Alta</span>
                  <h3>Menos llamadas de lo habitual</h3>
                  <p>12 llamadas frente a 31 de media los cuatro jueves anteriores, a la misma hora.</p>
                </Reveal>
                <Reveal className="lp-signal" delay={90}>
                  <span className="lp-level media">Media</span>
                  <h3>Casi todo son conversaciones cortas</h3>
                  <p>El 88 % de las conversaciones de hoy dura menos de 5 minutos.</p>
                </Reveal>
                <Reveal className="lp-signal" delay={180}>
                  <span className="lp-level positiva">Positiva</span>
                  <h3>Buenas primeras conversaciones</h3>
                  <p>3 primeros contactos de más de 15 minutos. Así se abre un lead.</p>
                </Reveal>
              </div>
            </div>
          </section>

          {/* ── Seguridad ────────────────────────────────────────────────── */}
          <section className="lp-section alt" id="seguridad">
            <div className="lp-wrap">
              <Reveal>
                <p className="lp-kicker">Seguridad</p>
                <h2>Los datos de tu equipo, a buen recaudo</h2>
              </Reveal>
              <div className="lp-security">
                {[
                  [
                    "Solo tu equipo",
                    "Acceso con Google Workspace y una lista de personas que gestionan tus administradores.",
                  ],
                  ["Solo lectura", "Ni el panel ni la IA pueden cambiar nada en tu cuenta de Ringover."],
                  [
                    "Todo queda registrado",
                    "Cada consulta de la IA, con quién, desde qué app y cuánto contexto usó.",
                  ],
                  [
                    "Alojado en Europa",
                    "Servidores en Alemania y tokens que caducan y se pueden revocar al momento.",
                  ],
                ].map(([t, d], i) => (
                  <Reveal key={t} delay={i * 70} className="lp-sec">
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>

          {/* ── Solicitar acceso ─────────────────────────────────────────── */}
          <section className="lp-section lp-access" id="acceso">
            <div className="lp-wrap lp-split">
              <Reveal>
                <p className="lp-kicker">Acceso anticipado</p>
                <h2>¿Tu equipo usa Ringover? Pruébalo con tus llamadas</h2>
                <p className="lp-lead">
                  Cuéntanos quiénes sois y te escribimos para conectar vuestra cuenta. En minutos tendréis el
                  panel con vuestro histórico y la IA lista para preguntar.
                </p>
                <ul className="lp-checks">
                  <li>Sin instalar nada: solo una clave de la API de Ringover</li>
                  <li>Hasta 12 meses de histórico desde el primer día</li>
                  <li>Te acompañamos en la puesta en marcha</li>
                </ul>
              </Reveal>
              <Reveal delay={120}>
                <LeadForm />
              </Reveal>
            </div>
          </section>

          {/* ── Preguntas frecuentes ─────────────────────────────────────── */}
          <section className="lp-section alt" id="preguntas">
            <div className="lp-wrap lp-faq-wrap">
              <Reveal>
                <p className="lp-kicker">Preguntas frecuentes</p>
                <h2>Lo que suelen preguntarnos</h2>
              </Reveal>
              <div className="lp-faq">
                {FAQ.map((f) => (
                  <details key={f.q}>
                    <summary>
                      <h3>{f.q}</h3>
                    </summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* ── Llamada final ────────────────────────────────────────────── */}
          <section className="lp-final">
            <div className="lp-wrap">
              <Reveal>
                <BrandMarkLogo size={56} />
                <h2>Tu equipo ya está llamando. Ahora, entiéndelo.</h2>
                <div className="lp-cta center">
                  <a className="lp-btn primary" href="#acceso">
                    Solicitar acceso
                  </a>
                  <button type="button" className="lp-btn ghost" onClick={() => setLoginOpen(true)}>
                    Ya tengo cuenta
                  </button>
                </div>
              </Reveal>
            </div>
          </section>
        </main>

        <SiteFooter badge />
        <CookieNotice />
      </div>
      {loginOpen ? (
        <LoginModal onClose={() => setLoginOpen(false)} initialError={initialError} connecting={connecting} />
      ) : null}
    </TooltipProvider>
  );
}

function MiniKpi({
  label,
  value,
  delta,
  spark,
}: {
  label: string;
  value: ReactNode;
  delta: string;
  spark: number[];
}) {
  return (
    <div className="lp-kpi">
      <span className="lp-kpi-top">
        <span className="lp-kpi-label">{label}</span>
        <span className="delta good">{delta}</span>
      </span>
      <b className="lp-kpi-value">{value}</b>
      <Sparkline
        values={spark}
        labels={spark.map((_, i) => `Día ${i + 1}`)}
        format={(v) => (v === null ? "—" : v.toLocaleString("es-ES"))}
        height={26}
      />
    </div>
  );
}

const AI_ANSWER =
  "Hay 47 leads con una primera conversación de más de 5 minutos a los que nadie ha vuelto a llamar en 3 días. Los tres más calientes:\n\n1. Lead A · 18 min con Lucía · hace 4 días\n2. Lead B · 16 min con Diego · hace 3 días\n3. Lead C · 14 min con Carla · hace 5 días\n\nTe sugiero que Lucía empiece por el primero: fue la conversación más larga.";

function AiDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setTimeout(() => setStart(true), 700);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="lp-chat" ref={ref} role="img" aria-label="Ejemplo de conversación con la IA">
      <div className="lp-chat-head">
        <span className="lp-chat-dot" />
        Claude · conector Ringover 4Geeks
      </div>
      <div className="lp-msg user">¿Qué leads calientes llevan más de 3 días sin que nadie los llame?</div>
      <div className={`lp-tool${start ? " on" : ""}`} style={{ "--d": "0ms" } as CSSProperties}>
        <span className="lp-tool-ico">⚙</span> seguimientos_pendientes
        <code>{"{ dias_sin_llamar: 3 }"}</code>
        <span className="lp-tool-ok">47 resultados · 65 ms</span>
      </div>
      <div className="lp-msg ai">
        <Typewriter text={AI_ANSWER} start={start} />
      </div>
    </div>
  );
}

// ── Formulario de acceso ─────────────────────────────────────────────────────

const SIZES = [
  ["1-5", "1 a 5 comerciales"],
  ["6-20", "6 a 20"],
  ["21-50", "21 a 50"],
  ["51-200", "51 a 200"],
  ["200+", "Más de 200"],
] as const;

function LeadForm() {
  const create = useCreateLead();
  const [f, setF] = useState({
    nombre: "",
    email: "",
    empresa: "",
    comerciales: "",
    telefono: "",
    mensaje: "",
    web: "",
  });
  const [consent, setConsent] = useState(false);
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((x) => ({ ...x, [k]: e.target.value }));

  if (create.isSuccess) {
    return (
      <div className="lp-form lp-form-done" role="status">
        <span className="lp-done-ico">✓</span>
        <h3>¡Recibido, {f.nombre.split(" ")[0]}!</h3>
        <p>
          Te escribiremos a {f.email} para conectar vuestro Ringover. Mientras tanto, echa un vistazo a las
          preguntas frecuentes.
        </p>
      </div>
    );
  }

  return (
    <form
      className="lp-form"
      aria-label="Solicitar acceso a Ringover 4Geeks"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ ...f, consentimiento: consent });
      }}
    >
      <div className="lp-form-row">
        <label className="field">
          Nombre
          <input className="input" required autoComplete="name" value={f.nombre} onChange={set("nombre")} />
        </label>
        <label className="field">
          Email de trabajo
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            value={f.email}
            onChange={set("email")}
          />
        </label>
      </div>
      <div className="lp-form-row">
        <label className="field">
          Empresa
          <input
            className="input"
            required
            autoComplete="organization"
            value={f.empresa}
            onChange={set("empresa")}
          />
        </label>
        <label className="field">
          Tamaño del equipo comercial
          <select className="select input" required value={f.comerciales} onChange={set("comerciales")}>
            <option value="" disabled>
              Elige una opción
            </option>
            {SIZES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>
          Teléfono <span className="opt">(opcional)</span>
        </span>
        <input
          className="input"
          type="tel"
          autoComplete="tel"
          value={f.telefono}
          onChange={set("telefono")}
        />
      </label>
      <label className="field">
        <span>
          ¿Qué te gustaría resolver? <span className="opt">(opcional)</span>
        </span>
        <textarea className="input textarea" rows={3} value={f.mensaje} onChange={set("mensaje")} />
      </label>
      <label className="lp-hp" aria-hidden="true">
        Web
        <input tabIndex={-1} autoComplete="off" value={f.web} onChange={set("web")} />
      </label>
      <label className="lp-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
        <span>
          He leído la{" "}
          <a href="/privacidad" target="_blank" rel="noopener">
            política de privacidad
          </a>{" "}
          y acepto que 4Geeks Academy use estos datos para responder a mi solicitud.
        </span>
      </label>
      {create.error ? (
        <div className="form-error" role="alert">
          {create.error.message}
        </div>
      ) : null}
      <button type="submit" className="lp-btn primary" disabled={create.isPending}>
        {create.isPending ? "Enviando…" : "Solicitar acceso"}
      </button>
      {/* Primera capa de información (RGPD art. 13); la segunda es /privacidad. */}
      <p className="lp-privacy">
        <b>Responsable:</b> {COMPANY.name}. <b>Finalidad:</b> responder a tu solicitud y proponerte un plan;
        no te enviaremos otra publicidad. <b>Legitimación:</b> tu consentimiento. <b>Destinatarios:</b> nadie,
        salvo los proveedores que nos alojan y envían el aviso, en la UE. <b>Derechos:</b> acceso,
        rectificación, supresión y los demás, en <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.{" "}
        <a href="/privacidad" target="_blank" rel="noopener">
          Más información
        </a>
        .
      </p>
    </form>
  );
}
