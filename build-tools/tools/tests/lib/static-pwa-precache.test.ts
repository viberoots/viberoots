#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ensureDistStaticPwaPrecache,
  listStaticPwaPrecacheAssetUrls,
} from "../../lib/static-pwa-precache";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function writeFiles(rootDir: string, relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const absPath = path.join(rootDir, relativePath);
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await fsp.writeFile(absPath, relativePath);
  }
}

test("static pwa precache lists emitted chunks plus worker and wasm assets", async () => {
  await withTempDir("static-pwa-precache-", async (clientDir) => {
    await writeFiles(clientDir, [
      "entry-client.js",
      "assets/chunk-A.js",
      "assets/solver-runtime-worker.js",
      "assets/solver-runtime-worker.css",
      "assets/solver-runtime.wasm",
      "assets/logo.svg",
      "icons/icon-192.png",
      "manifest.webmanifest",
      "server/wasm/top.wasm",
      "service-worker.js",
      "README.txt",
    ]);

    assert.deepEqual(listStaticPwaPrecacheAssetUrls(clientDir), [
      "/assets/chunk-A.js",
      "/assets/logo.svg",
      "/assets/solver-runtime-worker.css",
      "/assets/solver-runtime-worker.js",
      "/assets/solver-runtime.wasm",
      "/entry-client.js",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
    ]);
  });
});

test("static pwa precache materialization is deterministic for fixed built outputs", async () => {
  const serviceWorkerSource = [
    'const CACHE_VERSION = "__STATIC_PWA_CACHE_VERSION__";',
    "const PRECACHE_URLS = [",
    '  "/",',
    "  ...__STATIC_PWA_PRECACHED_ASSETS__,",
    "];",
  ].join("\n");

  const createClientDir = async (rootDir: string, relativePaths: string[]): Promise<string> => {
    const clientDir = path.join(rootDir, "dist", "client");
    await writeFiles(clientDir, relativePaths);
    await fsp.writeFile(path.join(clientDir, "service-worker.js"), serviceWorkerSource);
    return clientDir;
  };

  await withTempDir("static-pwa-precache-a-", async (tmpA) => {
    await withTempDir("static-pwa-precache-b-", async (tmpB) => {
      const clientDirA = await createClientDir(tmpA, [
        "manifest.webmanifest",
        "assets/chunk-B.js",
        "assets/solver-worker.js",
        "assets/solver.wasm",
        "entry-client.js",
      ]);
      const clientDirB = await createClientDir(tmpB, [
        "entry-client.js",
        "assets/solver.wasm",
        "assets/solver-worker.js",
        "assets/chunk-B.js",
        "manifest.webmanifest",
      ]);

      const stateA = ensureDistStaticPwaPrecache(clientDirA);
      const stateB = ensureDistStaticPwaPrecache(clientDirB);
      const outputA = await fsp.readFile(path.join(clientDirA, "service-worker.js"), "utf8");
      const outputB = await fsp.readFile(path.join(clientDirB, "service-worker.js"), "utf8");

      assert.deepEqual(stateA, stateB);
      assert.equal(outputA, outputB);
      assert.match(outputA, /const CACHE_VERSION = "static-pwa-[0-9a-f]{12}";/);
      assert.match(outputA, /"\/assets\/solver-worker\.js"/);
      assert.match(outputA, /"\/assets\/solver\.wasm"/);
      assert.doesNotMatch(outputA, /__STATIC_PWA_(CACHE_VERSION|PRECACHED_ASSETS)__/);
    });
  });
});

test("static pwa precache can include manifest-declared runtime urls before files are staged", async () => {
  await withTempDir("static-pwa-precache-extra-", async (clientDir) => {
    await writeFiles(clientDir, ["entry-client.js", "manifest.webmanifest", "service-worker.js"]);

    assert.deepEqual(listStaticPwaPrecacheAssetUrls(clientDir, { extraUrls: ["/top.wasm"] }), [
      "/entry-client.js",
      "/manifest.webmanifest",
      "/top.wasm",
    ]);
  });
});
