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
        assert.match(String(scripts.dev), /dev-with-wasm-watch\.ts/);
        assert.match(String(scripts["dev:wasm:watch"]), /watch-wasm-producer\.ts/);
        await fsp.access(path.join(appRoot, "scripts", "build-wasm-producer.mjs"));
        await fsp.access(path.join(appRoot, "app", "wasm-producer", "payload.txt"));
        const { outPath, importer } = await buildSelectedSsr(tmp, _$, label, "next");
        await assertSsrAdapterConformance({ label, outPath, importer, framework: "next" });
      });
    });
  },
);
