#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { ensureNodeModulesForDevApp } from "./lib/dev-node-modules";
import { httpGet, pickFreePort, stopServer } from "./lib/webapp-static-hmr";
import {
  assertSingleQueueInvariant,
  captureHmrMutationEventsDuring,
  waitForHmrConnected,
} from "./lib/wasm-watch";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-static wasm producer watcher rebuilds and syncs without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
    await runInTemp("webapp-static-wasm-producer", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-static demo-web --yes --no-tests --skip-lockfile-gen`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-web");
      const appRel = "projects/apps/demo-web";
      const producerPayloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      await fsp.mkdir(path.dirname(producerPayloadPath), { recursive: true });
      await fsp.writeFile(producerPayloadPath, "phase2-a", "utf8");

      const { esbuildBin } = await ensureNodeModulesForDevApp({
        tmp,
        appAbs,
        appRel,
        $,
        _$,
      });

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      let hmrWs: WebSocket | null = null;
      const devServer = spawn("pnpm", ["run", "dev"], {
        cwd: appAbs,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "development",
          NODE_OPTIONS: "",
          ESBUILD_BINARY_PATH: esbuildBin,
          PORT: String(port),
        },
      });
      devServer.stdout?.on("data", (chunk) => {
        serverStdout.push(String(chunk || ""));
        if (serverStdout.length > 300) serverStdout.shift();
      });
      devServer.stderr?.on("data", (chunk) => {
        serverStderr.push(String(chunk || ""));
        if (serverStderr.length > 300) serverStderr.shift();
      });

      try {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 45000) {
          try {
            const res = await httpGet(`http://127.0.0.1:${port}/`);
            if (res.status === 200) break;
          } catch {}
          await sleep(300);
        }
        {
          const probe = await httpGet(`http://127.0.0.1:${port}/`).catch(() => ({
            status: 0,
            body: "",
          }));
          if (probe.status !== 200) {
            const tailOut = serverStdout.join("").slice(-6000);
            const tailErr = serverStderr.join("").slice(-6000);
            throw new Error(
              [
                "server did not become ready within 45000ms",
                `vite stdout tail:\n${tailOut}`,
                `vite stderr tail:\n${tailErr}`,
              ].join("\n\n"),
            );
          }
        }
        hmrWs = new WebSocket(`ws://127.0.0.1:${port}`, "vite-hmr");
        await waitForHmrConnected(hmrWs, 10000);
        const wasmUrl = `http://127.0.0.1:${port}/src/wasm-contract/top.wasm`;
        const firstWasm = await httpGet(wasmUrl);
        assert.equal(firstWasm.status, 200);
        assert.match(firstWasm.body, /phase2-a/);

        const phase2BEventsPromise = captureHmrMutationEventsDuring(hmrWs, 3000, async () => {
          await fsp.writeFile(producerPayloadPath, "phase2-b", "utf8");
          const now = new Date();
          await fsp.utimes(producerPayloadPath, now, now);
        });

        let sawPhase2B = false;
        for (let i = 0; i < 80; i++) {
          const current = await httpGet(wasmUrl);
          if (current.status === 200 && current.body.includes("phase2-b")) {
            sawPhase2B = true;
            break;
          }
          await sleep(300);
        }
        assert.equal(sawPhase2B, true, "expected wasm producer update to reach app wasm path");
        const phase2BEvents = await phase2BEventsPromise;
        assert.equal(
          phase2BEvents.sawFullReload,
          false,
          "strict HMR path violated: received full-reload event for wasm update",
        );

        const phase2C2EventsPromise = captureHmrMutationEventsDuring(hmrWs, 3000, async () => {
          await fsp.writeFile(producerPayloadPath, "phase2-c1", "utf8");
          await fsp.writeFile(producerPayloadPath, "phase2-c2", "utf8");
          const burstNow = new Date();
          await fsp.utimes(producerPayloadPath, burstNow, burstNow);
        });
        let sawPhase2C2 = false;
        for (let i = 0; i < 80; i++) {
          const current = await httpGet(wasmUrl);
          if (current.status === 200 && current.body.includes("phase2-c2")) {
            sawPhase2C2 = true;
            break;
          }
          await sleep(300);
        }
        assert.equal(
          sawPhase2C2,
          true,
          "expected burst edit latest value to sync to app wasm path",
        );
        const phase2C2Events = await phase2C2EventsPromise;
        assert.equal(
          phase2C2Events.sawFullReload,
          false,
          "strict HMR path violated: received full-reload event after burst producer edits",
        );

        const mergedLogs = `${serverStdout.join("")}\n${serverStderr.join("")}`;
        assert.match(mergedLogs, /\[wasm-watch\] coordinator:registered/);
        assert.doesNotMatch(mergedLogs, /\bfull-reload\b/);
        assertSingleQueueInvariant(mergedLogs);
      } finally {
        try {
          hmrWs?.close();
        } catch {}
        await stopServer(devServer);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
