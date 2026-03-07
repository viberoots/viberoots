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
import {
  assertNoProcessRestart,
  assertSingleQueueInvariant,
  producerByteLength,
  waitForConsecutive,
  waitForValue,
  writeAndBumpMtime,
} from "./lib/wasm-watch";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

const STEP_TIMEOUT_MS = Number(process.env.NEXT_DEV_STEP_TIMEOUT_SECS || "180") * 1000,
  NEXT_DEV_POLL_MS = 500;

test(
  "webapp-ssr-next runtime consistency stays deterministic across repeated mixed cycles without restart or hang",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    await runInTemp("webapp-ssr-next-runtime-consistency", async (tmp, _$) => {
      process.env.NIX_PNPM_ALLOW_GENERATE = "1";
      process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";

      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-next demo-next-ssr --yes --no-tests --skip-lockfile-gen`;
      await $`scaf new ts lib demo-lib --yes --no-tests --skip-lockfile-gen`;

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
        exports: { ".": { default: "./src/index.ts" } },
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
      await writeAndBumpMtime(libSourcePath, writeLibSource("client-a", "server-a"));
      await writeAndBumpMtime(payloadPath, "runtime-a");

      await _$({
        cwd: tmp,
        stdio: "pipe",
      })`git add -A projects/apps/demo-next-ssr projects/libs/demo-lib`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-next-ssr... --no-frozen-lockfile --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const pageUrl = `http://127.0.0.1:${port}/`;
      const serverStdout: string[] = [],
        serverStderr: string[] = [];
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
        const readServerPage = async () => await httpGet(pageUrl);
        assert.equal(devServer.exitCode, null, "dev server exited before startup");
        await waitForHttpOk(pageUrl, STEP_TIMEOUT_MS);

        const expectedA = producerByteLength("runtime-a");
        await waitForValue(
          readServerPage,
          (res) =>
            res.status === 200 &&
            res.body.includes("server:server-a") &&
            res.body.includes(`server-wasm:${expectedA}`),
          STEP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        const initialClientProbe = await waitForValue(
          async () => await clientAssetsContain(pageUrl, "client-a"),
          (value) => value,
          STEP_TIMEOUT_MS,
          NEXT_DEV_POLL_MS,
        );
        assert.equal(initialClientProbe, true);

        const serverPid = devServer.pid;
        assert.ok(serverPid && serverPid > 0, "dev server pid must be available");

        const cycles = [
          { tag: "b", client: "client-b", server: "server-b", payload: "runtime-bbb" },
          { tag: "c", client: "client-c", server: "server-c", payload: "runtime-cccc" },
        ];

        for (const cycle of cycles) {
          await writeAndBumpMtime(
            libSourcePath,
            writeLibSource(cycle.client, `server-${cycle.tag}-prev`),
          );
          await waitForValue(
            async () => await clientAssetsContain(pageUrl, cycle.client),
            (value) => value,
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assertNoProcessRestart(devServer, serverPid);

          await waitForConsecutive(
            () => clientAssetsContain(pageUrl, cycle.client),
            2,
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );

          await writeAndBumpMtime(libSourcePath, writeLibSource(cycle.client, cycle.server));
          await waitForValue(
            readServerPage,
            (res) => res.status === 200 && res.body.includes(`server:${cycle.server}`),
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assertNoProcessRestart(devServer, serverPid);

          await writeAndBumpMtime(payloadPath, cycle.payload);
          const expectedWasm = producerByteLength(cycle.payload);
          await waitForValue(
            readServerPage,
            (res) => res.status === 200 && res.body.includes(`server-wasm:${expectedWasm}`),
            STEP_TIMEOUT_MS,
            NEXT_DEV_POLL_MS,
          );
          assertNoProcessRestart(devServer, serverPid);
        }

        const mergedLogs = `${serverStdout.join("")}\n${serverStderr.join("")}`;
        assert.match(mergedLogs, /\[wasm-watch\] coordinator:registered/);
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
