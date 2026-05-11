#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "single-module watcher flags are removed with stable migration diagnostics",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-single-module-watcher-flag-removal", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts webapp-ssr-vite demo-vite --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts webapp-ssr-next demo-next --yes --no-tests --skip-lockfile-gen`;

      for (const appName of ["demo-web", "demo-vite", "demo-next"]) {
        const scriptPath = path.join(
          tmp,
          "projects",
          "apps",
          appName,
          "scripts",
          "dev-wasm-watch.mjs",
        );
        const source = await fsp.readFile(scriptPath, "utf8");
        assert.match(source, /watch-wasm-coordinator\.ts/);
        assert.doesNotMatch(source, /--watch|--build-cmd|--build-out|--sync-out/);
      }
    });
  },
);
