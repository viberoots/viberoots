#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertSsrAdapterConformance } from "../lib/ssr-adapter-conformance.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  TEST_TIMEOUT_MS,
  buildSelectedSsr,
  scaffoldAndPrepareWorkspace,
  withTempRoots,
} from "./lib/webapp-ssr.ts";

test(
  "SSR next contracts: materialize listing and adapter conformance",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await withTempRoots(async () => {
      await runInTemp("node-webapp-ssr-next-contracts", async (tmp, _$) => {
        const appName = "demo-ssr-next";
        const label = `//projects/apps/${appName}:app`;
        await scaffoldAndPrepareWorkspace(tmp, _$, "webapp-ssr-next", appName);
        const appRoot = path.join(tmp, "projects", "apps", appName);
        const packageJson = JSON.parse(
          await fsp.readFile(path.join(appRoot, "package.json"), "utf8"),
        ) as {
          scripts?: Record<string, string>;
        };
        const scripts = packageJson.scripts || {};
        assert.equal(typeof scripts.dev, "string");
        assert.equal(typeof scripts["dev:ssr"], "string");
        assert.equal(typeof scripts["dev:ssr:only"], "string");
        assert.equal(typeof scripts["dev:wasm"], "string");
        assert.equal(typeof scripts["dev:wasm:watch"], "string");
        assert.equal(String(scripts.dev), "node scripts/dev.mjs");
        assert.equal(String(scripts["dev:wasm:watch"]), "node scripts/dev-wasm-watch.mjs");
        assert.equal(String(scripts["build:ssr"]), "node scripts/build-ssr.mjs");
        const devScript = await fsp.readFile(path.join(appRoot, "scripts", "dev.mjs"), "utf8");
        assert.match(devScript, /dev-with-wasm-watch\.ts/);
        const devWasmWatchScript = await fsp.readFile(
          path.join(appRoot, "scripts", "dev-wasm-watch.mjs"),
          "utf8",
        );
        assert.match(devWasmWatchScript, /watch-wasm-coordinator\.ts/);
        assert.doesNotMatch(devWasmWatchScript, /build-wasm-producer\.mjs/);
        assert.doesNotMatch(devWasmWatchScript, /--watch|--build-cmd|--build-out|--sync-out/);
        const buildSsrScript = await fsp.readFile(
          path.join(appRoot, "scripts", "build-ssr.mjs"),
          "utf8",
        );
        assert.match(buildSsrScript, /next build/);
        assert.match(buildSsrScript, /tsc -p tsconfig\.server\.json/);
        await fsp.access(path.join(appRoot, "app", "wasm-producer", "payload.txt"));
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "next");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "next" });
      });
    });
  },
);
