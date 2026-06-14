#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { after, test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { producerByteLength, waitForValue, writeAndBumpMtime } from "./lib/wasm-watch";
import {
  evaluateRenderedAppText,
  GENERATED_DEV_READY_TIMEOUT_MS,
  httpGet,
  pickFreePort,
  stopServer,
  waitForChildHttpOk,
} from "./lib/webapp-static-hmr";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function clientEntrySource(tag: string): string {
  return [
    'const root = document.getElementById("app");',
    "if (root) {",
    `  root.textContent = "client:${tag}";`,
    "}",
    "",
  ].join("\n");
}

function serverEntrySource(tag: string): string {
  return [
    'import { readServerWasmContractByteLength } from "../server/wasm-contract";',
    "",
    "export async function render(url: string): Promise<string> {",
    '  const safeUrl = url.replace(/"/g, "&quot;");',
    "  const bytes = await readServerWasmContractByteLength();",
    `  return '<main id="app" data-ssr-marker="vite">server:${tag}:' + String(bytes) + ' at ' + safeUrl + "</main>";`,
    "}",
    "",
  ].join("\n");
}

test(
  "webapp-ssr-vite dev runtime consistency remains deterministic across repeated edit cycles",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_FETCH_TIMEOUT = process.env.NIX_PNPM_FETCH_TIMEOUT || "240";
    await runInTemp("webapp-ssr-vite-dev-runtime-consistency", async (tmp, _$) => {
      const $ = _$({ cwd: tmp, stdio: "inherit" });
      await $`scaf new ts webapp-ssr-vite demo-vite-ssr --yes --no-tests --skip-lockfile-gen`;

      const appAbs = path.join(tmp, "projects", "apps", "demo-vite-ssr");
      const payloadPath = path.join(appAbs, "src", "wasm-producer", "payload.txt");
      const entryClientPath = path.join(appAbs, "src", "entry-client.ts");
      const entryServerPath = path.join(appAbs, "src", "entry-server.ts");

      await writeAndBumpMtime(payloadPath, "phase3-a");
      await writeAndBumpMtime(entryClientPath, clientEntrySource("a"));
      await writeAndBumpMtime(entryServerPath, serverEntrySource("a"));

      await _$({ cwd: tmp, stdio: "pipe" })`git add -A projects/apps/demo-vite-ssr`;
      await _$({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
      })`pnpm --dir ${tmp} install --filter ./projects/apps/demo-vite-ssr... --no-frozen-lockfile --prefer-offline --ignore-scripts --reporter=append-only`;

      const port = await pickFreePort();
      const serverStdout: string[] = [];
      const serverStderr: string[] = [];
      const mainModuleUrl = `http://127.0.0.1:${port}/src/entry-client.ts`;
      let clientEvalSerial = 0;
      const evaluateClientText = async (): Promise<string> => {
        clientEvalSerial += 1;
        return await evaluateRenderedAppText(
          `${mainModuleUrl}?t=${Date.now()}-${clientEvalSerial}`,
        );
      };
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
        await waitForChildHttpOk(
          devServer,
          `http://127.0.0.1:${port}/`,
          GENERATED_DEV_READY_TIMEOUT_MS,
        );

        const serverPid = devServer.pid;
        assert.ok(serverPid && serverPid > 0, "dev server pid must be available");

        let currentWasmLength = producerByteLength("phase3-a");
        const initialClientText = await waitForValue(
          evaluateClientText,
          (value) => value === "client:a",
        );
        assert.equal(initialClientText, "client:a");
        const initialClientWasmLength = await waitForValue(
          readClientWasmLength,
          (value) => value === currentWasmLength,
        );
        assert.equal(initialClientWasmLength, currentWasmLength);
        const initialServerBody = await waitForValue(
          async () => await httpGet(`http://127.0.0.1:${port}/`),
          (res) => res.status === 200 && res.body.includes(`server:a:${currentWasmLength} at /`),
        );
        assert.equal(initialServerBody.status, 200);
        assert.equal(devServer.exitCode, null);
        assert.equal(devServer.pid, serverPid);

        const cycles = [
          { tag: "b", payload: "phase3-bbb" },
          { tag: "c", payload: "phase3-cccc" },
        ];
        for (const cycle of cycles) {
          await writeAndBumpMtime(entryClientPath, clientEntrySource(cycle.tag));
          const clientTextAfterClientEdit = await waitForValue(
            evaluateClientText,
            (value) => value === `client:${cycle.tag}`,
          );
          assert.equal(clientTextAfterClientEdit, `client:${cycle.tag}`);
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);

          await writeAndBumpMtime(entryServerPath, serverEntrySource(cycle.tag));
          const serverBodyAfterServerEdit = await waitForValue(
            async () => await httpGet(`http://127.0.0.1:${port}/`),
            (res) =>
              res.status === 200 &&
              res.body.includes(`server:${cycle.tag}:${currentWasmLength} at /`),
          );
          assert.equal(serverBodyAfterServerEdit.status, 200);
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);

          await writeAndBumpMtime(payloadPath, cycle.payload);
          currentWasmLength = producerByteLength(cycle.payload);
          const clientWasmLengthAfterWasmEdit = await waitForValue(
            readClientWasmLength,
            (value) => value === currentWasmLength,
          );
          assert.equal(clientWasmLengthAfterWasmEdit, currentWasmLength);
          const serverBodyAfterWasmEdit = await waitForValue(
            async () => await httpGet(`http://127.0.0.1:${port}/`),
            (res) =>
              res.status === 200 &&
              res.body.includes(`server:${cycle.tag}:${currentWasmLength} at /`),
          );
          assert.equal(serverBodyAfterWasmEdit.status, 200);
          assert.equal(devServer.exitCode, null);
          assert.equal(devServer.pid, serverPid);
        }
      } catch (error) {
        const tailOut = serverStdout.join("").slice(-8000);
        const tailErr = serverStderr.join("").slice(-8000);
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            "startup and update diagnostics:",
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
