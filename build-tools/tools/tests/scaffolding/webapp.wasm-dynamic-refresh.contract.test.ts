#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { stopServer } from "./lib/webapp-static-hmr";
import { assertSingleQueueInvariant, waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import { runInTemp } from "../lib/test-helpers";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;
const STEP_TIMEOUT_MS = Math.max(25000, Math.min(120000, Math.floor(TEST_TIMEOUT_MS / 8)));

async function waitForValueOrWatcherFailure<T>(opts: {
  getter: () => Promise<T>;
  check: (value: T) => boolean;
  watcher: { exitCode: number | null };
  logs: string[];
  timeoutMs: number;
  pollMs: number;
  label: string;
}): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    if (opts.watcher.exitCode != null) {
      throw new Error(
        `[hmr-contract] watcher exited while waiting for ${opts.label} (code=${opts.watcher.exitCode})\n${opts.logs.join("").slice(-12000)}`,
      );
    }
    const merged = opts.logs.join("");
    if (
      merged.includes("[wasm-watch] refresh:fail") ||
      merged.includes("[wasm-watch] rebuild:fail")
    ) {
      throw new Error(
        `[hmr-contract] watcher reported failure while waiting for ${opts.label}\n${merged.slice(-12000)}`,
      );
    }
    const value = await opts.getter();
    if (opts.check(value)) return value;
    await sleep(opts.pollMs);
  }
  throw new Error(
    `[hmr-contract] timed out waiting for ${opts.label} after ${opts.timeoutMs}ms\n${opts.logs.join("").slice(-12000)}`,
  );
}

test(
  "wasm in-session refresh enrolls and retires module keys without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("vbr-wasm-dynamic-refresh", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const targetPath = path.join(appAbs, "TARGETS");
      const topPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const extraPayloadPath = path.join(appAbs, "src", "wasm-producer", "extra.txt");
      const topContractPath = path.join(appAbs, "src", "wasm-contract", "top.wasm");
      const extraContractPath = path.join(appAbs, "src", "wasm-contract", "extra.wasm");

      await fsp.writeFile(topPayloadPath, "top-0", "utf8");

      const logs: string[] = [];
      const watcher = spawn(
        "zx-wrapper",
        [
          "../../../viberoots/build-tools/tools/dev/watch-wasm-coordinator.ts",
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
      const initialPid = watcher.pid;

      try {
        await waitForValueOrWatcherFailure({
          getter: async () => await fsp.readFile(topContractPath, "utf8").catch(() => ""),
          check: (body) => body.includes("top-0"),
          watcher,
          logs,
          timeoutMs: STEP_TIMEOUT_MS,
          pollMs: 150,
          label: "initial top contract",
        });

        await fsp.writeFile(extraPayloadPath, "extra-0", "utf8");
        await writeAndBumpMtime(targetPath, await fsp.readFile(targetPath, "utf8"));
        await waitForValueOrWatcherFailure({
          getter: async () => await fsp.readFile(extraContractPath, "utf8").catch(() => ""),
          check: (body) => body.includes("extra-0"),
          watcher,
          logs,
          timeoutMs: STEP_TIMEOUT_MS,
          pollMs: 150,
          label: "extra contract enrollment",
        });

        await writeAndBumpMtime(extraPayloadPath, "extra-1");
        await waitForValueOrWatcherFailure({
          getter: async () => await fsp.readFile(extraContractPath, "utf8"),
          check: (body) => body.includes("extra-1"),
          watcher,
          logs,
          timeoutMs: STEP_TIMEOUT_MS,
          pollMs: 150,
          label: "extra contract refresh",
        });

        await fsp.rm(extraPayloadPath, { force: true });
        await writeAndBumpMtime(targetPath, await fsp.readFile(targetPath, "utf8"));
        const merged = await waitForValue(
          async () => logs.join(""),
          (text) => text.includes("[wasm-watch] coordinator:refresh modules=1"),
          20000,
          150,
        );
        assert.equal(watcher.exitCode, null, "watcher exited during in-session refresh");
        assert.equal(watcher.pid, initialPid, "watcher process restarted unexpectedly");
        assert.match(merged, /\[wasm-watch\] coordinator:registered /);
        assertSingleQueueInvariant(merged);
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
