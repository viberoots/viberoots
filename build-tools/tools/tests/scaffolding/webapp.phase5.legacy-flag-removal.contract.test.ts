#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "PR-9 removes legacy single-module watcher flags with stable migration diagnostics",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-phase5-legacy-flag-removal", async (tmp) => {
      const scriptAbs = path.join(tmp, "build-tools", "tools", "dev", "watch-wasm-producer.ts");
      const child = spawn(
        "zx-wrapper",
        [
          scriptAbs,
          "--cwd",
          ".",
          "--watch",
          "src/wasm-producer/payload.txt",
          "--build-cmd",
          "echo noop",
          "--build-out",
          ".wasm-producer/top.wasm",
          "--sync-out",
          "src/wasm-contract/top.wasm",
        ],
        {
          cwd: tmp,
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        },
      );
      const logs: string[] = [];
      child.stdout.on("data", (chunk) => logs.push(String(chunk || "")));
      child.stderr.on("data", (chunk) => logs.push(String(chunk || "")));
      const exitCode = await new Promise<number>((resolve) =>
        child.once("exit", (code) => resolve(code ?? 1)),
      );
      const joined = logs.join("");
      assert.notEqual(exitCode, 0);
      assert.match(joined, /\[wasm-watch\] legacy-args:unsupported/);
      assert.match(joined, /--watch,--build-cmd,--build-out,--sync-out/);
      assert.match(joined, /migration: remove legacy watcher flags/);
    });
  },
);
