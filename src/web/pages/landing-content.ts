// Textos de la landing que también usan los datos estructurados (JSON-LD) y llms.txt.
// Una sola fuente: lo que ve la persona es lo mismo que leen Google y las IAs.

export const SITE = {
  url: "https://ringover.duckdns.org",
  name: "Ringover 4Geeks",
  title: "Analítica de llamadas e IA para Ringover | Ringover 4Geeks",
  description:
    "Convierte las llamadas de Ringover en decisiones: 9 métricas por comercial, la jornada en tiempo real, alertas automáticas y un conector MCP para preguntar a Claude o ChatGPT. Un producto de 4Geeks.",
  publisher: "4Geeks Academy",
  publisherUrl: "https://4geeks.com",
};

export const HOW_IT_WORKS = [
  {
    title: "Conecta tu Ringover",
    text: "Con una clave de la API de Ringover de solo lectura. No hay que instalar nada ni cambiar cómo trabaja tu equipo.",
  },
  {
    title: "Importamos tu histórico",
    text: "Traemos hasta 12 meses de llamadas y, desde ahí, sincronizamos cada 3 minutos y medimos el tiempo conectado de cada comercial.",
  },
  {
    title: "Tu equipo y tu IA, dentro",
    text: "Entran con su cuenta de Google Workspace y conectan Claude, ChatGPT o Cursor por MCP para preguntar en lenguaje natural.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Qué es Ringover 4Geeks?",
    a: "Una capa de analítica e inteligencia artificial para equipos comerciales que usan Ringover. Se conecta a la API de Ringover y convierte cada llamada en métricas por comercial, la jornada en tiempo real, alertas automáticas y un conector MCP para preguntar a Claude o ChatGPT.",
  },
  {
    q: "¿Es un producto oficial de Ringover?",
    a: "No. Es un producto independiente creado por 4Geeks Academy que usa la API pública de Ringover. Ringover es una marca de su respectivo titular.",
  },
  {
    q: "¿Qué necesito para empezar?",
    a: "Una cuenta de Ringover con acceso a la API y una clave de solo lectura. Importamos hasta 12 meses de histórico y, en minutos, tu equipo tiene su panel.",
  },
  {
    q: "¿Qué métricas de llamadas incluye?",
    a: "Llamadas totales, nuevas y de seguimiento; tiempo en llamada, al teléfono y conectado a Ringover; llamadas de más de 15 minutos y de menos de 5; y primeras conversaciones de más de 15 minutos. Todo por comercial, por día y comparado con su propia media.",
  },
  {
    q: "¿Cómo se conecta con Claude o ChatGPT?",
    a: "Mediante un servidor MCP con 15 herramientas de solo lectura. En claude.ai y ChatGPT se añade como conector con la cuenta de cada persona (OAuth); en Claude Code o Cursor, con un token personal con caducidad. Puedes preguntar por todo el equipo, por una persona o por un grupo de comerciales.",
  },
  {
    q: "¿Puede la IA cambiar algo en Ringover?",
    a: "No. Todo es de solo lectura: ni el panel ni la IA pueden modificar llamadas, contactos ni la configuración de Ringover. Además, cada consulta de la IA queda registrada.",
  },
  {
    q: "¿Dónde se guardan los datos?",
    a: "En servidores en Europa (Alemania). Solo acceden las cuentas autorizadas de tu empresa, con inicio de sesión de Google Workspace y una lista de acceso que gestionan tus administradores.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: "Estamos en acceso anticipado. Cuéntanos en el formulario cuántos comerciales tiene tu equipo y te proponemos un plan.",
  },
];
