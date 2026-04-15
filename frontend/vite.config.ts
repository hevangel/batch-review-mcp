import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.VITE_BACKEND_PORT ?? "9000";
  const backendHttp = `http://127.0.0.1:${backendPort}`;
  const backendWs = `ws://127.0.0.1:${backendPort}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: backendHttp, changeOrigin: true },
        "/ws": { target: backendWs, ws: true },
        "/mcp": { target: backendHttp, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
