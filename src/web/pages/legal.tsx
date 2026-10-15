import { type ReactNode, useEffect } from "react";
import { COMPANY, LEAD_RETENTION_DAYS, LEGAL_UPDATED } from "../../shared/legal";
import { CookieNotice } from "../components/cookie-notice";
import { SiteFooter } from "../components/footer";
import { SiteHeader } from "../components/site-header";
import { LEGAL_PAGES, LEGAL_SLUGS, type LegalSlug, STORAGE_ITEMS } from "./legal-content";

// Aviso legal, privacidad y cookies. Públicas con o sin sesión y prerenderizadas en el
// servidor (scripts/prerender.tsx): nada de window en el render.

const mail = <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>;

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const page = LEGAL_PAGES[slug];
  useEffect(() => {
    document.title = `${page.title} | Ringover 4Geeks`;
  }, [page.title]);
  return (
    <div className="lp">
      <SiteHeader home={false} />

      <main className="lp-wrap lg">
        <nav className="lg-tabs" aria-label="Textos legales">
          {LEGAL_SLUGS.map((s) => (
            <a key={s} href={`/${s}`} aria-current={s === slug ? "page" : undefined}>
              {LEGAL_PAGES[s].label}
            </a>
          ))}
        </nav>
        <h1>{page.title}</h1>
        <p className="lg-date">Última actualización: {LEGAL_UPDATED}</p>
        <article className="lg-body">
          {slug === "aviso-legal" ? <AvisoLegal /> : slug === "privacidad" ? <Privacidad /> : <Cookies />}
        </article>
      </main>

      <SiteFooter current={slug} />
      <CookieNotice />
    </div>
  );
}

function Titular() {
  return (
    <dl className="lg-dl">
      <dt>Titular</dt>
      <dd>{COMPANY.name}</dd>
      <dt>NIF</dt>
      <dd>{COMPANY.nif}</dd>
      <dt>Domicilio</dt>
      <dd>{COMPANY.address}</dd>
      <dt>Inscripción</dt>
      <dd>{COMPANY.registry}</dd>
      <dt>Contacto</dt>
      <dd>{mail}</dd>
    </dl>
  );
}

// ── Aviso legal (LSSI-CE) ────────────────────────────────────────────────────
function AvisoLegal() {
  return (
    <>
      <h2>1. Quién está detrás</h2>
      <p>
        En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de
        comercio electrónico (LSSI-CE), estos son los datos del titular de ringover.duckdns.org:
      </p>
      <Titular />

      <h2>2. Objeto</h2>
      <p>
        Este sitio presenta Ringover 4Geeks, un servicio de analítica de llamadas e inteligencia artificial
        para equipos comerciales que usan Ringover, y da acceso al panel a las cuentas autorizadas. Usar el
        sitio supone aceptar este aviso legal, la <a href="/privacidad">política de privacidad</a> y la{" "}
        <a href="/cookies">política de cookies</a>.
      </p>

      <h2>3. Relación con Ringover</h2>
      <p>
        Ringover 4Geeks es un producto independiente de {COMPANY.name} que usa la API pública de Ringover. No
        está afiliado, patrocinado ni respaldado por Ringover. «Ringover» es una marca de su titular y aquí se
        cita solo para indicar con qué servicio es compatible.
      </p>

      <h2>4. Uso del sitio y del panel</h2>
      <p>Te comprometes a usar el sitio de forma lícita y, en particular, a no:</p>
      <ul>
        <li>intentar acceder al panel, a la API o a datos sin autorización;</li>
        <li>introducir código malicioso o sobrecargar el servicio de forma deliberada;</li>
        <li>compartir tus accesos o tus tokens personales con otras personas.</li>
      </ul>
      <p>
        Podemos suspender el acceso de quien incumpla estas condiciones. La insignia «Destroy this website»
        del pie es un juego: solo cambia lo que ves en tu navegador y no afecta al sitio ni a sus datos.
      </p>

      <h2>5. Datos de ejemplo</h2>
      <p>
        Las cifras, nombres, gráficos y conversaciones que se muestran en la página principal son de ejemplo y
        no corresponden a personas ni empresas reales.
      </p>

      <h2>6. Propiedad intelectual e industrial</h2>
      <p>
        Los textos, el diseño, el código, los logotipos y el resto de contenidos del sitio pertenecen a{" "}
        {COMPANY.name} o se usan con licencia. No se pueden reproducir, distribuir ni transformar sin permiso
        por escrito, salvo para uso personal. Las marcas de terceros pertenecen a sus titulares.
      </p>

      <h2>7. Responsabilidad</h2>
      <p>
        Trabajamos para que el sitio funcione bien y la información sea correcta, pero no podemos garantizar
        que esté siempre disponible ni libre de errores. Las métricas del panel dependen de los datos que
        facilita la API de Ringover. No respondemos de los daños causados por interrupciones o fallos ajenos a
        nuestro control, ni por un uso indebido del sitio.
      </p>

      <h2>8. Enlaces a otros sitios</h2>
      <p>
        El sitio enlaza a servicios de terceros, como Ringover, Google o Sprite Fusion. No controlamos su
        contenido ni sus políticas, y no somos responsables de ellos.
      </p>

      <h2>9. Ley aplicable</h2>
      <p>
        Este aviso se rige por la ley española. Cualquier controversia se resolverá en los juzgados y
        tribunales de Madrid, salvo que la ley reconozca a quien la plantee el derecho a acudir a otros.
      </p>
    </>
  );
}

// ── Política de privacidad (RGPD y LOPDGDD) ──────────────────────────────────
const TREATMENTS: { title: string; rows: [string, ReactNode][] }[] = [
  {
    title: "Si nos pides acceso desde el formulario",
    rows: [
      [
        "Datos",
        "Nombre, email de trabajo, empresa y tamaño del equipo comercial; teléfono y mensaje si los das. Además, la fecha, la IP y el navegador desde los que lo envías.",
      ],
      [
        "Para qué",
        "Responder a tu solicitud, proponerte un plan y, si lo contratas, poner en marcha el servicio. La IP y el navegador sirven para frenar abusos y acreditar tu consentimiento. No te enviaremos otra publicidad.",
      ],
      [
        "Base jurídica",
        "Tu consentimiento (art. 6.1.a RGPD) y la aplicación, a tu petición, de medidas precontractuales (art. 6.1.b).",
      ],
      [
        "Cuánto tiempo",
        `Mientras gestionamos tu solicitud y, como máximo, ${LEAD_RETENTION_DAYS / 365} años desde que la envías. Pasado ese plazo se borra automáticamente. Si te haces cliente, pasamos a guardarla mientras dure la relación.`,
      ],
    ],
  },
  {
    title: "Si usas el panel",
    rows: [
      [
        "Datos",
        "Tu nombre y tu email, la fecha de tu último acceso y la sesión abierta. No guardamos contraseñas: las de 4Geeks Center las comprueba Center, y con Google entras con tu cuenta de Google.",
      ],
      ["Para qué", "Darte acceso a los datos de tu empresa y proteger las cuentas."],
      [
        "Base jurídica",
        "La ejecución del contrato con tu empresa (art. 6.1.b) y nuestro interés legítimo en la seguridad del servicio (art. 6.1.f).",
      ],
      ["Cuánto tiempo", "Mientras tengas acceso. Las sesiones caducan a las pocas horas."],
    ],
  },
  {
    title: "Si conectas una IA (Claude, ChatGPT, Cursor…)",
    rows: [
      [
        "Datos",
        "Qué consulta hizo la IA, cuándo, desde qué aplicación, con qué resultado y cuánto tardó. Los tokens se guardan como huella cifrada (hash): ni nosotros podemos verlos.",
      ],
      ["Para qué", "Seguridad, límites de uso y que tu empresa pueda ver el consumo."],
      [
        "Base jurídica",
        "La ejecución del contrato (art. 6.1.b) y el interés legítimo en la seguridad (art. 6.1.f).",
      ],
      ["Cuánto tiempo", "180 días."],
    ],
  },
  {
    title: "Si solo visitas la página",
    rows: [
      [
        "Datos",
        "La IP, la fecha, la página pedida y el navegador quedan en los registros técnicos del servidor. No usamos analítica ni cookies de seguimiento.",
      ],
      ["Para qué", "Que el sitio funcione y detectar ataques."],
      ["Base jurídica", "Nuestro interés legítimo en la seguridad del servicio (art. 6.1.f)."],
      ["Cuánto tiempo", "El imprescindible: los registros se borran periódicamente."],
    ],
  },
];

function Privacidad() {
  return (
    <>
      <p className="lg-intro">
        Aquí te contamos qué datos tratamos en Ringover 4Geeks, para qué, durante cuánto tiempo y cómo puedes
        ejercer tus derechos, según el Reglamento General de Protección de Datos (RGPD, UE 2016/679) y la Ley
        Orgánica 3/2018 de Protección de Datos y garantía de los derechos digitales (LOPDGDD).
      </p>

      <h2>1. Responsable</h2>
      <Titular />

      <h2>2. Qué datos tratamos y para qué</h2>
      <div className="lg-cards">
        {TREATMENTS.map((t) => (
          <section key={t.title} className="lg-card">
            <h3>{t.title}</h3>
            <dl className="lg-dl">
              {t.rows.map(([k, v]) => (
                <div key={k} className="lg-row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <h2>3. Los datos de las llamadas de tu empresa</h2>
      <p>
        Si tu empresa contrata Ringover 4Geeks, tratamos los datos de sus llamadas (números, fechas,
        duraciones, qué comercial atendió y su estado de conexión) solo para prestarle el servicio, siguiendo
        sus instrucciones y como encargados del tratamiento (art. 28 RGPD), según el contrato que firmamos con
        ella. La responsable de esos datos es tu empresa: si eres uno de sus comerciales o de sus contactos,
        dirígete a ella para ejercer tus derechos, o escríbenos y se lo trasladamos.
      </p>
      <p>
        Todo es de solo lectura: ni el panel ni la IA pueden cambiar nada en Ringover. Si conectas una IA, lo
        que consulte llega a ese proveedor (Anthropic, OpenAI, Cursor…) con tu cuenta y según sus condiciones.
        Tú decides qué conectas y puedes revocar el acceso cuando quieras desde el panel.
      </p>

      <h2>4. A quién se los damos</h2>
      <p>
        No vendemos ni cedemos datos a terceros, salvo obligación legal. Nos ayudan estos proveedores, que
        solo los tratan por cuenta nuestra y con contrato:
      </p>
      <ul>
        <li>
          <b>Hetzner Online GmbH</b> (Alemania): alojamiento del servicio y de la base de datos.
        </li>
        <li>
          <b>Sendinblue SAS, «Brevo»</b> (Francia): envío a nuestro equipo del aviso de tu solicitud.
        </li>
        <li>
          <b>Google Ireland Limited</b> (Irlanda): correo electrónico de nuestro equipo e inicio de sesión con
          Google.
        </li>
      </ul>

      <h2>5. Transferencias fuera de la UE</h2>
      <p>
        El servicio y la base de datos están en la Unión Europea (Alemania). Si algún proveedor tratara datos
        fuera del Espacio Económico Europeo, lo hace con las garantías del RGPD: una decisión de adecuación de
        la Comisión Europea (como el Marco de Privacidad de Datos UE-EE. UU.) o sus cláusulas contractuales
        tipo.
      </p>

      <h2>6. Tus derechos</h2>
      <p>
        Puedes pedirnos en cualquier momento acceder a tus datos, rectificarlos o suprimirlos, oponerte a su
        tratamiento, limitarlo o recibirlos en un formato portable. También puedes retirar tu consentimiento,
        sin que eso afecte a lo tratado antes.
      </p>
      <p>
        Escríbenos a {mail} indicando qué derecho quieres ejercer. Si hace falta, te pediremos que acredites
        tu identidad. Respondemos en un plazo máximo de un mes.
      </p>
      <p>
        Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección
        de Datos (
        <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">
          www.aepd.es
        </a>
        ).
      </p>

      <h2>7. Cómo los protegemos</h2>
      <ul>
        <li>Todo viaja cifrado (HTTPS).</li>
        <li>No guardamos contraseñas, y los tokens de la IA se guardan como huella (hash).</li>
        <li>Solo entran las cuentas autorizadas, con sesiones que caducan y se revisan.</li>
        <li>Cada consulta de una IA queda registrada.</li>
      </ul>

      <h2>8. Menores</h2>
      <p>Ringover 4Geeks es un servicio para empresas y no está dirigido a menores de 14 años.</p>

      <h2>9. Cambios</h2>
      <p>
        Si cambiamos esta política, publicaremos aquí la nueva versión con su fecha. Si el cambio es
        importante, te avisaremos.
      </p>
    </>
  );
}

// ── Política de cookies ──────────────────────────────────────────────────────
function Cookies() {
  return (
    <>
      <p className="lg-intro">
        <b>Resumen:</b> solo usamos cookies y almacenamiento técnicos y propios. Nada de analítica,
        publicidad, redes sociales ni seguimiento entre sitios. Si solo visitas la página, no instalamos
        ninguna cookie.
      </p>

      <h2>1. Qué son</h2>
      <p>
        Las cookies son pequeños archivos que un sitio guarda en tu navegador. El almacenamiento local
        (localStorage) es una tecnología parecida. Las dos sirven, por ejemplo, para mantener tu sesión
        abierta.
      </p>

      <h2>2. Las que usamos</h2>
      <table className="lg-table">
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Tipo</th>
            <th scope="col">Para qué</th>
            <th scope="col">Duración</th>
          </tr>
        </thead>
        <tbody>
          {STORAGE_ITEMS.map((c) => (
            <tr key={c.name}>
              <td data-label="Nombre">
                <code>{c.name}</code>
              </td>
              <td data-label="Tipo">{c.kind}</td>
              <td data-label="Para qué">{c.purpose}</td>
              <td data-label="Duración">{c.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>3. Por qué no te pedimos permiso</h2>
      <p>
        Estas cookies son necesarias para prestar el servicio que pides (entrar en el panel) o recuerdan una
        preferencia que eliges tú (el tema). Por eso están exentas de consentimiento según el artículo 22.2 de
        la LSSI-CE y la Guía sobre el uso de las cookies de la AEPD. Si algún día añadimos otras, te pediremos
        permiso antes de instalarlas y podrás rechazarlas igual de fácil que aceptarlas.
      </p>

      <h2>4. Terceros</h2>
      <p>No hay cookies de terceros. Dos detalles:</p>
      <ul>
        <li>
          La insignia «Destroy this website» del pie se carga desde destroy.spritefusion.com (Sprite Fusion),
          que recibe tu IP como cualquier servidor que sirve una imagen. No instala cookies. Si pulsas en
          ella, se aplica la política de Sprite Fusion.
        </li>
        <li>Si entras con Google, en las páginas de Google se aplican sus propias cookies y su política.</li>
      </ul>

      <h2>5. Cómo borrarlas o bloquearlas</h2>
      <p>
        Puedes hacerlo desde tu navegador:{" "}
        <a
          href="https://support.google.com/chrome/answer/95647?hl=es"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chrome
        </a>
        ,{" "}
        <a
          href="https://support.mozilla.org/es/kb/Borrar%20cookies"
          target="_blank"
          rel="noopener noreferrer"
        >
          Firefox
        </a>
        ,{" "}
        <a href="https://support.apple.com/es-es/105082" target="_blank" rel="noopener noreferrer">
          Safari
        </a>{" "}
        o{" "}
        <a
          href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09"
          target="_blank"
          rel="noopener noreferrer"
        >
          Edge
        </a>
        . Si bloqueas las cookies técnicas, no podrás iniciar sesión en el panel.
      </p>

      <h2>6. Más información</h2>
      <p>
        Para cualquier duda, escríbenos a {mail}. Lo que hacemos con tus datos está en la{" "}
        <a href="/privacidad">política de privacidad</a>.
      </p>
    </>
  );
}
