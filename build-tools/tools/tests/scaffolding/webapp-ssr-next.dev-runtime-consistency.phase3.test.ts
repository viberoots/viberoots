#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { nextWasmClientProbeSource, nextWasmPageSource, writeLibSource } from "./lib/next-dev";
import { assertSingleQueueInvariant, producerByteLength, waitForValue } from "./lib/wasm-watch";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

const STARTUP_TIMEOUT_MS = 45000,
  STEP_TIMEOUT_MS = 120000,
  NEXT_DEV_POLL_MS = 1000;

test(
  "webapp-ssr-next Phase 3 runtime consistency is deterministic across repeated mixed cycles without restart or hang",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-phase3-runtime-consistency", async (tmp, _$) => {
      process.env.NIX_PNPM_ALLOW_GENERATE = "1";
      process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";

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
      await fsp.writeFile(appPagePath, nextWasmPageSource(), "utf8");
      await fsp.writeFile(appClientProbePath, nextWasmClientProbeSource(), "utf8");
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
      await fsp.writeFile(payloadPath, "phase3-a", "utf8");

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
      const pageUrl = `http://127.0.0.1:${port}/`;
      const serverStdout: string[] = [],
        serverStderr: string[] = [];
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
        await waitForValue(
          async () => `${serverStdout.join("")}\n${serverStderr.join("")}`,
          (logs) => logs.includes("Ready in"),
          STARTUP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        await waitForHttpOk(pageUrl, STEP_TIMEOUT_MS);

        const expectedA = producerByteLength("phase3-a");
        await waitForValue(
          readClientWasmLength,
          (v) => v === expectedA,
          STEP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        await waitForValue(
          async () => await httpGet(pageUrl),
          (res) =>
            res.status === 200 &&
            res.body.includes("server:server-a") &&
            res.body.includes(`server-wasm:${expectedA}`),
          STEP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        const initialClientProbe = await waitForValue(
          async () => await httpGet(pageUrl),
          (res) => res.status === 200 && res.body.includes("client:client-a"),
          STEP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(initialClientProbe.status, 200);

        const serverPid = devServer.pid;
        assert.ok(serverPid && serverPid > 0, "dev server pid must be available");

        const cycles = [
          { tag: "b", client: "client-b", server: "server-b", payload: "phase3-bbb" },
          { tag: "c", client: "client-c", server: "server-c", payload: "phase3-cccc" },
          { tag: "d", client: "client-d", server: "server-d", payload: "phase3-ddddd" },
        ];

        for (const cycle of cycles) {
          await fsp.writeFile(
            libSourcePath,
            writeLibSource(cycle.client, `server-${cycle.tag}-prev`),
            "utf8",
          );
          const clientNow = new Date();
          await fsp.utimes(libSourcePath, clientNow, clientNow);
          await waitForValue(
            async () => await httpGet(pageUrl),
            (res) => res.status === 200 && res.body.includes(`client:${cycle.client}`),
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);

          await fsp.writeFile(libSourcePath, writeLibSource(cycle.client, cycle.server), "utf8");
          const serverNow = new Date();
          await fsp.utimes(libSourcePath, serverNow, serverNow);
          await waitForValue(
            async () => await httpGet(pageUrl),
            (res) => res.status === 200 && res.body.includes(`server:${cycle.server}`),
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);

          await fsp.writeFile(payloadPath, cycle.payload, "utf8");
          const payloadNow = new Date();
          await fsp.utimes(payloadPath, payloadNow, payloadNow);
          const expectedWasm = producerByteLength(cycle.payload);
          await waitForValue(
            readClientWasmLength,
            (v) => v === expectedWasm,
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          await waitForValue(
            async () => await httpGet(pageUrl),
            (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedWasm}`),
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);
        }

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
            "runtime diagnostics:",
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
