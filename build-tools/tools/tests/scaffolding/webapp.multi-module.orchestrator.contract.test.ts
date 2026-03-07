#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

type TemplateWatcherExpectation = {
  id: string;
  scriptPath: string;
};

const TEMPLATE_WATCHERS: TemplateWatcherExpectation[] = [
  {
    id: "ts/webapp-static",
    scriptPath: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-static",
      "scripts",
      "dev-wasm-watch.mjs.jinja",
    ),
  },
  {
    id: "ts/webapp-ssr-vite",
    scriptPath: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-ssr-vite",
      "scripts",
      "dev-wasm-watch.mjs.jinja",
    ),
  },
  {
    id: "ts/webapp-ssr-next",
    scriptPath: path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      "ts",
      "webapp-ssr-next",
      "scripts",
      "dev-wasm-watch.mjs.jinja",
    ),
  },
];

test("PR-2 contract: watcher emits module-scoped deterministic markers", async () => {
  const watcherPath = path.join(
    REPO_ROOT,
    "build-tools",
    "tools",
    "dev",
    "watch-wasm-coordinator.ts",
  );
  const daemonPath = path.join(
    REPO_ROOT,
    "build-tools",
    "tools",
    "dev",
    "wasm-watch-coordinator-daemon.ts",
  );
  const source = await fsp.readFile(watcherPath, "utf8");
  const daemonSource = await fsp.readFile(daemonPath, "utf8");
  const opsPath = path.join(REPO_ROOT, "build-tools", "tools", "dev", "watch-wasm-producer-ops.ts");
  const opsSource = await fsp.readFile(opsPath, "utf8");
  assert.match(daemonSource, /\[wasm-watchd\] rebuild:start seq=/);
  assert.match(daemonSource, /\[wasm-watchd\] sync:ok seq=/);
  assert.match(daemonSource, /\[wasm-watchd\] rebuild:fail seq=/);
  assert.match(source, /\[wasm-watch\] coordinator:registered app_target=/);
  assert.match(source, /\[wasm-watch\] coordinator:refresh modules=/);
  assert.match(opsSource, /\[wasm-watch\] refresh:ok module_count=/);
  assert.match(source, /specsFromWasmManifest/);
  assert.match(source, /validateTsManifestProbes/);
});

test("PR-2 contract: template watchers rely on generated contract paths", async () => {
  for (const item of TEMPLATE_WATCHERS) {
    const abs = path.join(REPO_ROOT, item.scriptPath);
    const source = await fsp.readFile(abs, "utf8");
    assert.match(
      source,
      /watch-wasm-coordinator\.ts/,
      `${item.id}: watcher entrypoint changed unexpectedly`,
    );
    assert.doesNotMatch(source, /--wasm-manifest|--ts-manifest/);
    assert.doesNotMatch(source, /wasm-modules\.manifest\.json|ts-modules\.manifest\.json/);
    assert.doesNotMatch(
      source,
      /--watch/,
      `${item.id}: legacy single-module --watch flag should be absent`,
    );
    assert.doesNotMatch(
      source,
      /--build-cmd|--build-out|--sync-out/,
      `${item.id}: legacy single-module flags should be absent`,
    );
  }
});
