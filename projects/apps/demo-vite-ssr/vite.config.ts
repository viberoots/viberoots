import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  appType: "custom",
  clearScreen: false,
  logLevel: "info",
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: true,
    rollupOptions: isSsrBuild
      ? undefined
      : {
          input: "src/entry-client.ts",
          output: {
            entryFileNames: "entry-client.js",
            assetFileNames: "assets/[name][extname]",
          },
        },
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 5173,
    preTransformRequests: false,
  },
  cacheDir: ".vite-cache",
  optimizeDeps: {
    noDiscovery: true,
  },
}));
