import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8000";
const rootDir = dirname(fileURLToPath(import.meta.url));
const proxyPaths = [
  "/auth",
  "/users",
  "/classes",
  "/students",
  "/recognition",
  "/meal-entries",
  "/stats",
  "/settings",
  "/health",
  "/media",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: resolve(rootDir, "../sons"),
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: Object.fromEntries(
      proxyPaths.map((path) => [
        path,
        {
          target: proxyTarget,
          changeOrigin: true,
        },
      ]),
    ),
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
