import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "composition.js",
      },
    },
  },
});
