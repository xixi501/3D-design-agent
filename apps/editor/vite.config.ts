import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/editor"),
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: [path.resolve(".")] },
    proxy: { "/api": { target: "http://127.0.0.1:3001" } },
  },
  build: {
    outDir: path.resolve("dist/editor"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
