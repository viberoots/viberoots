import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureDistServiceWorkerPrecache,
  listPrecacheAssetUrls,
} from "../scripts/service-worker-precache.mjs";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pleomino-sw-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("service worker precache generation", () => {
  it("collects the built client runtime assets needed offline", () => {
    const clientDir = makeTempDir();
    mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    mkdirSync(path.join(clientDir, "icons"), { recursive: true });
    writeFileSync(path.join(clientDir, "entry-client.js"), "");
    writeFileSync(path.join(clientDir, "assets", "chunk-A.js"), "");
    writeFileSync(path.join(clientDir, "assets", "solver-worker.js"), "");
    writeFileSync(path.join(clientDir, "assets", "solver.wasm"), "");
    writeFileSync(path.join(clientDir, "icons", "icon-192.png"), "");
    writeFileSync(path.join(clientDir, "manifest.webmanifest"), "");
    writeFileSync(path.join(clientDir, "service-worker.js"), "ignored");
    writeFileSync(path.join(clientDir, "README.txt"), "ignored");

    expect(listPrecacheAssetUrls(clientDir)).toEqual([
      "/assets/chunk-A.js",
      "/assets/solver-worker.js",
      "/assets/solver.wasm",
      "/entry-client.js",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
    ]);
  });

  it("injects a concrete precache list into the built service worker", () => {
    const clientDir = makeTempDir();
    mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    writeFileSync(
      path.join(clientDir, "service-worker.js"),
      [
        'const CACHE_VERSION = "__PLEOMINO_CACHE_VERSION__";',
        "const PRECACHE_URLS = [APP_SHELL_URL, ...__PLEOMINO_PRECACHED_ASSETS__];",
      ].join("\n"),
    );
    writeFileSync(path.join(clientDir, "entry-client.js"), "");
    writeFileSync(path.join(clientDir, "assets", "chunk-A.js"), "");

    const state = ensureDistServiceWorkerPrecache(clientDir);
    const output = readFileSync(path.join(clientDir, "service-worker.js"), "utf8");

    expect(state.urls).toEqual(["/assets/chunk-A.js", "/entry-client.js"]);
    expect(output).toContain('const CACHE_VERSION = "pleomino-');
    expect(output).toContain('"/assets/chunk-A.js"');
    expect(output).toContain('"/entry-client.js"');
    expect(output).not.toContain("__PLEOMINO_CACHE_VERSION__");
    expect(output).not.toContain("__PLEOMINO_PRECACHED_ASSETS__");
  });
});
