import { defineConfig } from "vite";

// base "./" so the same build runs from itch.io's iframe CDN path and from a local preview.
// Runtime asset fetches must resolve against import.meta.env.BASE_URL, never "/".
export default defineConfig({
  base: "./",
  server: { port: 5173, host: true },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Phaser (and the one package it brings) in one chunk; the resident roster (residents.gen.json, 212 cards once
        // the census is written, MVP M-03) in its own, so a card edit doesn't invalidate the game's code chunk. The
        // entry chunk is the title alone: the rest of the game is a dynamic import (game.ts, boot/gameCode.ts).
        manualChunks(id) {
          if (id.includes("/node_modules/phaser/") || id.includes("/node_modules/eventemitter3/")) return "phaser";
          if (id.includes("/src/world/residents.gen.json")) return "residents";
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 1500
  }
});
