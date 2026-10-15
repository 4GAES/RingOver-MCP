import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/landing.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { queryClient } from "./lib/api";
import { applyStoredTheme } from "./lib/theme";

applyStoredTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
