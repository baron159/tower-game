import { defineConfig } from "vite";

// Vite is happy serving Rapier's pre-compiled WASM blob when we use the
// "-compat" build. No special copy step needed.

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Forward API + WS to the local wrangler dev instance.
      "/api": "http://127.0.0.1:8787",
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  optimizeDeps: {
    // Rapier ships an ESM bundle plus an inline WASM payload.
    include: ["@dimforge/rapier3d-compat"],
  },
});
