export default {
  appType: "spa",
  clearScreen: false,
  logLevel: "info",
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: true,
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 5187,
    preTransformRequests: false,
  },
  cacheDir: ".vite-cache",
  optimizeDeps: {
    // Avoid heavy prebundling in CI to keep startup fast
    disabled: true,
  },
};
