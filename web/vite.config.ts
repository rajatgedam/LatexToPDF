import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// In dev the API runs on 5757; the Origin header is stripped so the server's CSRF check sees a non-browser client.
type ProxyEvents = { on(event: "proxyReq", cb: (req: { removeHeader(name: string): void }) => void): void };

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [".."] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5757",
        changeOrigin: true,
        configure: (proxy) => (proxy as unknown as ProxyEvents).on("proxyReq", (req) => req.removeHeader("origin")),
      },
    },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.*"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
