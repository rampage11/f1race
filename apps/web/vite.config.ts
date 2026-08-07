import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(() => ({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
  resolve: {
    alias: {
      "@f1race/race-engine": fileURLToPath(
        new URL("../../packages/race-engine/src/index.ts", import.meta.url),
      ),
    },
  },
  server: { host: true, port: 5173 },
}));
