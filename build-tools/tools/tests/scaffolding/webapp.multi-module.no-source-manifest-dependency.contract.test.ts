#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { resolveModuleContractsPaths } from "../../dev/module-contract-paths.ts";
import { syncModuleContractsForApp } from "../../dev/sync-module-contracts-core.ts";
import { waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import { runInTemp } from "../lib/test-helpers";
import { stopServer } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-2 watcher does not require source-tree manifest files",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-no-source-manifest-dependency", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      await fsp.rm(path.join(appAbs, "src", "wasm-modules.manifest.json"), { force: true });
      await fsp.rm(path.join(appAbs, "src", "ts-modules.manifest.json"), { force: true });
      const contracts = resolveModuleContractsPaths({ appCwd: appAbs, root: tmp });
      await syncModuleContractsForApp({
        appCwd: appAbs,
        root: tmp,
        appTargetLabel: contracts.appTargetLabel,
      });

      const watcherAbs = path.join(tmp, "build-tools", "tools", "dev", "watch-wasm-producer.ts");
      const logs: string[] = [];
      const watcher = spawn(
        "zx-wrapper",
        [
          watcherAbs,
          "--cwd",
          appAbs,
          "--wasm-manifest",
          contracts.wasmManifestPath,
          "--ts-manifest",
          contracts.tsManifestPath,
          "--poll-ms",
          "120",
        ],
        {
          cwd: appAbs,
          stdio: "pipe",
          env: process.env,
        },
      );
      watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));
      try {
        await writeAndBumpMtime(
          path.join(appAbs, "src", "wasm-producer", "payload.txt"),
          `source-manifest-free-${Date.now()}`,
        );
        let body = "";
        try {
          body = await waitForValue(
            async () =>
              await fsp.readFile(path.join(appAbs, "src", "wasm-contract", "top.wasm"), "utf8"),
            (txt) => txt.includes("source-manifest-free-"),
            60000,
            150,
          );
        } catch (error) {
          throw new Error(
            [
              error instanceof Error ? error.message : String(error),
              `watcher logs tail:\n${logs.join("").slice(-8000)}`,
            ].join("\n\n"),
          );
        }
        assert.match(body, /wasm-producer:/);
        const merged = logs.join("");
        assert.match(merged, /\[wasm-watch\] manifest:wasm/);
      } finally {
        await stopServer(watcher);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
