import { defineConfig } from "vite";

// base "./" so the same build runs from itch.io's iframe CDN path and from a local preview.
// Runtime asset fetches must resolve against import.meta.env.BASE_URL, never "/".
export default defineConfig({
  base: "./",
  server: { port: 5173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
    chunkSizeWarningLimit: 1500
  }
});
