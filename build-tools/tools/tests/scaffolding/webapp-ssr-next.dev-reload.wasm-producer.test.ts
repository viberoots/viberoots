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
const NEXT_DEV_UPDATE_TIMEOUT_MS = 120000;
const NEXT_DEV_POLL_MS = 500;

let fileTouchStep = 0;

async function writeAndBumpMtime(filePath: string, contents: string): Promise<void> {
  await fsp.writeFile(filePath, contents, "utf8");
  fileTouchStep += 1;
  const stamp = new Date(Date.now() + fileTouchStep * 1100);
  await fsp.utimes(filePath, stamp, stamp);
}

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
        await waitForHttpOk(pageUrl, NEXT_DEV_UPDATE_TIMEOUT_MS);
        const expectedA = producerByteLength("phase2-a");
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) =>
            res.status === 200 &&
            res.body.includes("server:server-a") &&
            res.body.includes(`server-wasm:${expectedA}`),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        const initialClientProbe = await clientAssetsContain(pageUrl, "client-a");
        assert.equal(initialClientProbe, true);

        const serverPid = devServer.pid;
        await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-a"));
        const clientProbeUpdated = await waitForValue(
          async () => await clientAssetsContain(pageUrl, "client-b"),
          (value) => value,
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(clientProbeUpdated, true);
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await writeAndBumpMtime(libSourcePath, writeLibSource("client-b", "server-b"));
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes("server:server-b"),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await writeAndBumpMtime(payloadPath, "phase2-bbb");
        const expectedB = producerByteLength("phase2-bbb");
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedB}`),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        await writeAndBumpMtime(payloadPath, "FAIL");
        const sawFailureLog = await waitForValue(
          async () => `${serverStdout.join("")}\n${serverStderr.join("")}`,
          (logs) =>
            logs.includes("[wasm-watch] rebuild:fail") &&
            logs.includes("[wasm-watch] recovery: run this command manually:"),
          30000,
        );
        assert.match(sawFailureLog, /\[wasm-watch\] rebuild:fail/);

        await writeAndBumpMtime(payloadPath, "phase2-c1");
        await writeAndBumpMtime(payloadPath, "phase2-c22");
        const expectedC = producerByteLength("phase2-c22");
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedC}`),
          NEXT_DEV_UPDATE_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
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
