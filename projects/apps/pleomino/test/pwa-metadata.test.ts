import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisFile = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(thisFile), "..");

describe("pwa metadata", () => {
  it("includes install metadata in index html", () => {
    const html = readFileSync(path.join(appRoot, "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="Pleomino"');
    expect(html).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(html).toContain('name="theme-color" content="#0b1324"');
    expect(html).toContain('id="app" data-ui-ready="false"');
    expect(html).not.toContain("data-ssr-marker");
  });

  it("registers a service worker from the client entry", () => {
    const entryClient = readFileSync(path.join(appRoot, "src/entry-client.ts"), "utf8");
    expect(entryClient).toContain("navigator.serviceWorker");
    expect(entryClient).toContain('register("/service-worker.js"');
    expect(entryClient).toContain('scope: "/"');
    expect(entryClient).not.toContain('addEventListener("load"');
    expect(entryClient).toContain("controllerchange");
    expect(entryClient).toContain("window.location.reload()");
    expect(entryClient).toContain("hydrate: false");
    expect(entryClient).not.toContain("PLEOMINO_URL_STATE_HASH_KEY");
  });

  it("ships a manifest with expected install fields", () => {
    const raw = readFileSync(path.join(appRoot, "public/manifest.webmanifest"), "utf8");
    const manifest = JSON.parse(raw) as {
      name?: string;
      display?: string;
      orientation?: string;
      start_url?: string;
      icons?: Array<{ src?: string; sizes?: string }>;
    };
    expect(manifest.name).toBe("Pleomino");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.start_url).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.icons?.some((icon) => icon.src === "/icons/icon-192.png")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.src === "/icons/icon-512.png")).toBe(true);
  });

  it("ships a service worker with offline app-shell and asset caching", () => {
    const serviceWorker = readFileSync(path.join(appRoot, "public/service-worker.js"), "utf8");
    expect(serviceWorker).toContain('const APP_SHELL_URL = "/"');
    expect(serviceWorker).toContain("__STATIC_PWA_PRECACHED_ASSETS__");
    expect(serviceWorker).toContain("__STATIC_PWA_CACHE_VERSION__");
    expect(serviceWorker).toContain('event.request.mode === "navigate"');
    expect(serviceWorker).toContain('requestUrl.pathname.endsWith(".wasm")');
    expect(serviceWorker).toContain("caches.open(APP_SHELL_CACHE)");
  });
});
