import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(thisFile), "..");

describe("service worker precache integration", () => {
  it("delegates precache materialization to the shared static-pwa utility", () => {
    const viteConfig = readFileSync(path.join(appRoot, "vite.config.ts"), "utf8");

    expect(viteConfig).toContain("materialize-static-pwa-precache.ts");
    expect(viteConfig).toContain('"--cache-version-prefix"');
    expect(viteConfig).toContain('"pleomino"');
    expect(viteConfig).toContain("process.execPath");
    expect(viteConfig).not.toContain("service-worker-precache.mjs");
  });

  it("keeps the service worker template on shared static-pwa placeholders", () => {
    const serviceWorker = readFileSync(path.join(appRoot, "public", "service-worker.js"), "utf8");

    expect(serviceWorker).toContain("__STATIC_PWA_CACHE_VERSION__");
    expect(serviceWorker).toContain("__STATIC_PWA_PRECACHED_ASSETS__");
    expect(serviceWorker).toContain('const APP_SHELL_URL = "/"');
  });
});
