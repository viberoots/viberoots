#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { stopServer } from "./lib/webapp-static-hmr";
import { writeAndBumpMtime } from "./lib/wasm-watch";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return;
    await sleep(pollMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

async function writeAndTouch(filePath: string, text: string): Promise<void> {
  await fsp.writeFile(filePath, text, "utf8");
  const stamp = new Date(Date.now() + 1200);
  await fsp.utimes(filePath, stamp, stamp);
}

test(
  "PR-2 concurrency: manifest-driven watcher handles 5 module keys fairly in one session",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("bnx-multi-module-watch", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const moduleKeys = ["a", "b", "c", "d", "e"];
      const payloadByKey = new Map(
        moduleKeys.map((key) => [key, path.join(appAbs, "src", "wasm-producer", `${key}.txt`)]),
      );
      const contractByKey = new Map(
        moduleKeys.map((key) => [key, path.join(appAbs, "src", "wasm-contract", `${key}.wasm`)]),
      );

      for (const key of moduleKeys) {
        const payloadPath = payloadByKey.get(key);
        if (!payloadPath) throw new Error(`missing payload path for key ${key}`);
        await fsp.writeFile(payloadPath, `${key}-0`, "utf8");
      }
      const targetPath = path.join(appAbs, "TARGETS");
      await writeAndBumpMtime(targetPath, await fsp.readFile(targetPath, "utf8"));

      const logs: string[] = [];
      const watcher = spawn(
        "zx-wrapper",
        [
          "../../../build-tools/tools/dev/watch-wasm-coordinator.ts",
          "--cwd",
          appAbs,
          "--poll-ms",
          "120",
        ],
        { cwd: appAbs, stdio: "pipe", env: process.env },
      );
      watcher.stdout?.on("data", (chunk) => logs.push(String(chunk || "")));
      watcher.stderr?.on("data", (chunk) => logs.push(String(chunk || "")));

      try {
        await waitFor(
          async () => {
            for (const key of moduleKeys) {
              const filePath = contractByKey.get(key);
              if (!filePath) return false;
              try {
                const body = await fsp.readFile(filePath, "utf8");
                if (!body.includes(`${key}-0`)) return false;
              } catch {
                return false;
              }
            }
            return true;
          },
          60000,
          150,
        );

        for (const key of moduleKeys) {
          const payloadPath = payloadByKey.get(key);
          if (!payloadPath) throw new Error(`missing payload path for key ${key}`);
          await writeAndTouch(payloadPath, `${key}-1`);
        }

        await waitFor(
          async () => {
            for (const key of moduleKeys) {
              const filePath = contractByKey.get(key);
              if (!filePath) return false;
              try {
                const body = await fsp.readFile(filePath, "utf8");
                if (!body.includes(`${key}-1`)) return false;
              } catch {
                return false;
              }
            }
            return true;
          },
          90000,
          150,
        );

        const mergedLogs = logs.join("");
        assert.match(mergedLogs, /\[wasm-watch\] coordinator:registered app_target=/);
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
