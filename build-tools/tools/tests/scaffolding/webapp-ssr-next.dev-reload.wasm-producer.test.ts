#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  clientAssetsContain,
  nextWasmClientProbeSource,
  nextWasmPageSource,
  writeLibSource,
} from "./lib/next-dev";
import { assertSingleQueueInvariant, producerByteLength, waitForValue } from "./lib/wasm-watch";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-ssr-next dev applies local TS edits and wasm producer edits in one session",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-wasm-producer", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests`;
      await $`scaf new ts lib demo-lib --yes --no-tests`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-next-ssr");
      const appPagePath = path.join(appAbs, "app", "page.tsx");
      const appClientProbePath = path.join(appAbs, "app", "client-probe.tsx");
      const appPackageJsonPath = path.join(appAbs, "package.json");
      const payloadPath = path.join(appAbs, "app", "wasm-producer", "payload.txt");
      const libPackageJsonPath = path.join(tmp, "projects", "libs", "demo-lib", "package.json");
      const libSourcePath = path.join(tmp, "projects", "libs", "demo-lib", "src", "index.ts");

      const pageSource = nextWasmPageSource();
      const clientProbeSource = nextWasmClientProbeSource();

      const appPackageJson = JSON.parse(await fsp.readFile(appPackageJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const libPackageJson = JSON.parse(await fsp.readFile(libPackageJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      const nextAppPackageJson = {
        ...appPackageJson,
        dependencies: {
          ...(appPackageJson.dependencies || {}),
          "@libs/demo-lib": "workspace:*",
        },
      };
      const nextLibPackageJson = {
        ...libPackageJson,
        exports: {
          ".": {
            default: "./src/index.ts",
          },
        },
        types: "./src/index.ts",
      };
      await fsp.writeFile(appPagePath, pageSource, "utf8");
      await fsp.writeFile(appClientProbePath, clientProbeSource, "utf8");
      await fsp.writeFile(
        appPackageJsonPath,
        JSON.stringify(nextAppPackageJson, null, 2) + "\n",
        "utf8",
      );
      await fsp.writeFile(
        libPackageJsonPath,
        JSON.stringify(nextLibPackageJson, null, 2) + "\n",
        "utf8",
      );
      await fsp.writeFile(libSourcePath, writeLibSource("client-a", "server-a"), "utf8");
      await fsp.writeFile(payloadPath, "phase2-a", "utf8");

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-next-ssr projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-next-ssr --filter ./projects/libs/demo-lib --no-frozen-lockfile --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const pageUrl = `http://127.0.0.1:${port}/`;
      const readClientWasmLength = async (): Promise<number | null> => {
        const candidates = ["/top.wasm", "/app/wasm-contract/top.wasm", "/wasm-contract/top.wasm"];
        for (const candidate of candidates) {
          const res = await httpGet(`http://127.0.0.1:${port}${candidate}`);
          if (res.status === 200) return Buffer.byteLength(res.body, "utf8");
        }
        try {
          const bytes = await fsp.readFile(path.join(appAbs, "app", "wasm-contract", "top.wasm"));
          return bytes.byteLength;
        } catch {
          return null;
        }
      };
      const devServer: ChildProcess = spawn("pnpm", ["run", "dev:ssr"], {
        cwd: appAbs,
        stdio: "pipe",
        env: {
          ...process.env,
          PORT: String(port),
          NODE_OPTIONS: "",
          NEXT_TELEMETRY_DISABLED: "1",
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
        await waitForHttpOk(pageUrl, 90000);
        const expectedA = producerByteLength("phase2-a");
        await waitForValue(readClientWasmLength, (v) => v === expectedA, 90000);
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) =>
            res.status === 200 &&
            res.body.includes("server:server-a") &&
            res.body.includes(`server-wasm:${expectedA}`),
          90000,
        );
        const initialClientProbe = await clientAssetsContain(pageUrl, "client-a");
        assert.equal(initialClientProbe, true);

        const serverPid = devServer.pid;
        await fsp.writeFile(libSourcePath, writeLibSource("client-b", "server-a"), "utf8");
        const now = new Date();
        await fsp.utimes(libSourcePath, now, now);
        const clientProbeUpdated = await waitForValue(
          async () => await clientAssetsContain(pageUrl, "client-b"),
          (value) => value,
          90000,
        );
        assert.equal(clientProbeUpdated, true);
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await fsp.writeFile(libSourcePath, writeLibSource("client-b", "server-b"), "utf8");
        const later = new Date();
        await fsp.utimes(libSourcePath, later, later);
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes("server:server-b"),
          90000,
        );
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await fsp.writeFile(payloadPath, "phase2-bbb", "utf8");
        const payloadNow = new Date();
        await fsp.utimes(payloadPath, payloadNow, payloadNow);
        const expectedB = producerByteLength("phase2-bbb");
        await waitForValue(readClientWasmLength, (v) => v === expectedB, 90000);
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedB}`),
          90000,
        );
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await fsp.writeFile(payloadPath, "FAIL", "utf8");
        const sawFailureLog = await waitForValue(
          async () => `${serverStdout.join("")}\n${serverStderr.join("")}`,
          (logs) =>
            logs.includes("[wasm-watch] rebuild:fail") &&
            logs.includes("[wasm-watch] recovery: run this command manually:"),
          30000,
        );
        assert.match(sawFailureLog, /\[wasm-watch\] rebuild:fail/);

        await fsp.writeFile(payloadPath, "phase2-c1", "utf8");
        await fsp.writeFile(payloadPath, "phase2-c22", "utf8");
        const burstNow = new Date();
        await fsp.utimes(payloadPath, burstNow, burstNow);
        const expectedC = producerByteLength("phase2-c22");
        await waitForValue(readClientWasmLength, (v) => v === expectedC, 90000);
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedC}`),
          90000,
        );

        const mergedLogs = `${serverStdout.join("")}\n${serverStderr.join("")}`;
        assert.match(mergedLogs, /\[wasm-watch\] rebuild:start/);
        assert.match(mergedLogs, /\[wasm-watch\] sync:ok/);
        assert.doesNotMatch(mergedLogs, /\bfull-reload\b/);
        assertSingleQueueInvariant(mergedLogs);
      } catch (error) {
        const tailOut = serverStdout.join("").slice(-8000);
        const tailErr = serverStderr.join("").slice(-8000);
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            `next stdout tail:\n${tailOut}`,
            `next stderr tail:\n${tailErr}`,
          ].join("\n\n"),
        );
      } finally {
        await stopServer(devServer);
      }
    });
  },
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});
