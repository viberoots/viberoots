#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { assertSingleQueueInvariant, producerByteLength, waitForValue } from "./lib/wasm-watch";
import { httpGet, pickFreePort, stopServer, waitForHttpOk } from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-ssr-vite wasm producer watcher updates client and server paths without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
    await runInTemp("webapp-ssr-vite-wasm-producer", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests`;
      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      const payloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const entryClientPath = path.join(appAbs, "src", "entry-client.ts");
      const entryServerPath = path.join(appAbs, "src", "entry-server.ts");
      const runtimeWasmPath = path.join(appAbs, "wasm", "top.wasm");
      const serverWasmPath = path.join(appAbs, "server", "wasm", "top.wasm");
      await fsp.writeFile(payloadPath, "phase2-a", "utf8");
      await fsp.writeFile(
        entryClientPath,
        [
          'const root = document.getElementById("app");',
          "if (root) {",
          '  void fetch("/src/wasm-contract/top.wasm").then(async (res) => {',
          "    if (!res.ok) throw new Error(`failed to load wasm contract asset: ${res.status}`);",
          "    const bytes = new Uint8Array(await res.arrayBuffer());",
          "    root.textContent = `client:${bytes.byteLength}`;",
          "  });",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      await fsp.writeFile(
        entryServerPath,
        [
          'import { readServerWasmContractByteLength } from "../server/wasm-contract";',
          "",
          "export async function render(url: string): Promise<string> {",
          '  const safeUrl = url.replace(/"/g, "&quot;");',
          "  const bytes = await readServerWasmContractByteLength();",
          '  return `<main id="app">server:${bytes} at ${safeUrl}</main>`;',
          "}",
          "",
        ].join("\n"),
        "utf8",
      );

      await _$({ cwd: tmp, stdio: "pipe" })`git add -A projects/apps/demo-vite-ssr`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm install --filter ./projects/apps/demo-vite-ssr --frozen-lockfile --ignore-scripts --reporter=append-only`;
      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const readClientWasmLength = async (): Promise<number | null> => {
        const res = await httpGet(`http://127.0.0.1:${port}/src/wasm-contract/top.wasm`);
        if (res.status !== 200) return null;
        return res.body.length;
      };
      const devServer = spawn("pnpm", ["run", "dev"], {
        cwd: appAbs,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "development",
          NODE_OPTIONS: "",
          NEXT_TELEMETRY_DISABLED: "1",
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
        await waitForHttpOk(`http://127.0.0.1:${port}/`);
        const expectedA = producerByteLength("phase2-a");
        const initialClientLen = await waitForValue(readClientWasmLength, (v) => v === expectedA);
        assert.equal(initialClientLen, expectedA);
        const initialServer = await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/`),
          (res) => res.status === 200 && res.body.includes(`server:${expectedA} at /`),
        );
        assert.equal(initialServer.status, 200);

        await fsp.writeFile(payloadPath, "phase2-bbb", "utf8");
        const now = new Date();
        await fsp.utimes(payloadPath, now, now);
        const expectedB = producerByteLength("phase2-bbb");
        const nextClientLen = await waitForValue(readClientWasmLength, (v) => v === expectedB);
        assert.equal(nextClientLen, expectedB);
        await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/`),
          (res) => res.status === 200 && res.body.includes(`server:${expectedB} at /`),
        );

        await fsp.rm(serverWasmPath, { force: true });
        await fsp.rm(runtimeWasmPath, { force: true });
        const missingWasmResponse = await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/`),
          (res) =>
            res.status === 500 &&
            res.body.includes("server wasm contract asset is missing at canonical runtime path"),
        );
        assert.equal(missingWasmResponse.status, 500);

        await fsp.writeFile(payloadPath, "phase2-c1", "utf8");
        await fsp.writeFile(payloadPath, "phase2-c22", "utf8");
        const burstNow = new Date();
        await fsp.utimes(payloadPath, burstNow, burstNow);
        const expectedC = producerByteLength("phase2-c22");
        const latestClientLen = await waitForValue(readClientWasmLength, (v) => v === expectedC);
        assert.equal(latestClientLen, expectedC);
        await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/`),
          (res) => res.status === 200 && res.body.includes(`server:${expectedC} at /`),
        );

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
            `vite stdout tail:\n${tailOut}`,
            `vite stderr tail:\n${tailErr}`,
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
