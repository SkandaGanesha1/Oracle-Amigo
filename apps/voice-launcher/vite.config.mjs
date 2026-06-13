import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));

export default {
  root: appRoot,
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react"
  },
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true
  }
};
