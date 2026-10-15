import type { SessionUser } from "../shared/api";
import { TooltipProvider } from "./components/tooltip";
import { TopBar } from "./components/topbar";
import { Skeleton } from "./components/ui";
import { HttpError, useMe } from "./lib/api";
import { useLocation } from "./lib/router";
import { AgentPage } from "./pages/agent";
import { CallsPage } from "./pages/calls";
import { IaPage } from "./pages/ia";
import { Landing } from "./pages/landing";
import { LegalPage } from "./pages/legal";
import { legalSlug } from "./pages/legal-content";
import { OverviewPage } from "./pages/overview";
import { UsersPage } from "./pages/users";

function Page({ me }: { me: SessionUser }) {
  const { path } = useLocation();
  if (path === "/usuarios") return <UsersPage me={me} />;
  if (path === "/ia") return <IaPage me={me} />;
  const agent = /^\/comercial\/(\d+)\/?$/.exec(path);
  if (agent) return <AgentPage id={Number(agent[1])} />;
  if (path === "/llamadas") return <CallsPage />;
  return <OverviewPage />;
}

// La landing llega ya renderizada desde el servidor a quien no tiene sesión: se sigue
// mostrando mientras se comprueba la sesión (sin pantallazo de carga).
const prerenderedLanding = document.getElementById("root")?.dataset.landing === "1";

export function App() {
  // Aviso legal, privacidad y cookies: públicas, con o sin sesión.
  const { path } = useLocation();
  const legal = legalSlug(path);
  return legal ? <LegalPage slug={legal} /> : <Main />;
}

function Main() {
  const me = useMe();
  const unauth = (me.error instanceof HttpError && me.error.status === 401) || me.data === null;

  if (me.isLoading && prerenderedLanding) return <Landing />;
  if (me.isLoading) {
    return (
      <div className="wrap" style={{ paddingTop: 80 }}>
        <Skeleton h={28} w={240} />
      </div>
    );
  }
  // Sin sesión: la landing pública, con el acceso en la cabecera.
  if (unauth || !me.data) return <Landing />;

  return (
    <TooltipProvider>
      <TopBar user={me.data.user} />
      <main>
        <div className="wrap">
          <Page me={me.data.user} />
        </div>
      </main>
    </TooltipProvider>
  );
}
