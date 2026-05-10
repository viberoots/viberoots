#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { stopServer } from "./lib/webapp-static-hmr";
import { waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-8 dynamic refresh negative path emits stable failure markers without refresh hot-loop",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("vbr-phase5-refresh-neg", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const payloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const topContractPath = path.join(appAbs, "src", "wasm-contract", "top.wasm");
      const packageJsonPath = path.join(appAbs, "package.json");
      const logs: string[] = [];
      const watcher = spawn(
        "zx-wrapper",
        [
          "../../../build-tools/tools/dev/watch-wasm-coordinator.ts",
          "--cwd",
          appAbs,
          "--poll-ms",
          "120",
          "--refresh-throttle-ms",
          "400",
        ],
        { cwd: appAbs, stdio: "pipe", env: process.env },
      );
      watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        await waitForValue(
          async () => await fsp.readFile(topContractPath, "utf8").catch(() => ""),
          (body) => body.includes("wasm-producer:"),
          45000,
          150,
        );

        const pkg = JSON.parse(await fsp.readFile(packageJsonPath, "utf8")) as {
          dependencies?: Record<string, string>;
        };
        pkg.dependencies = {
          ...(pkg.dependencies || {}),
          "@libs/does-not-exist": "workspace:*",
        };
        await fsp.writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        await writeAndBumpMtime(packageJsonPath, await fsp.readFile(packageJsonPath, "utf8"));
        await writeAndBumpMtime(payloadPath, "after-invalid-dep");

        let mergedAfterFail = "";
        try {
          mergedAfterFail = await waitForValue(
            async () => logs.join(""),
            (text) =>
              text.includes("[wasm-watch] fatal") &&
              text.includes("[module-contracts:E_TS_WORKSPACE_DEP]"),
            45000,
            150,
          );
        } catch (error) {
          mergedAfterFail = logs.join("");
          if (
            !mergedAfterFail.includes("[wasm-watch] fatal") ||
            !mergedAfterFail.includes("[module-contracts:E_TS_WORKSPACE_DEP]")
          ) {
            throw error;
          }
        }
        const fatalCount = (mergedAfterFail.match(/\[wasm-watch\] fatal/g) || []).length;
        assert.equal(fatalCount, 1, `expected single fatal marker, got ${fatalCount}`);
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
