import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.API_URL ?? "http://127.0.0.1:3020";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    strictPort: true,
    // changeOrigin: false conserva el Host original, como hace nginx en producción
    // (el servidor compara Origin con Host para frenar peticiones de otros sitios).
    proxy: {
      "/api": { target: API, changeOrigin: false },
      "/mcp": { target: API, changeOrigin: false },
      "/healthz": { target: API, changeOrigin: false },
      "/auth": { target: API, changeOrigin: false },
    },
  },
});
