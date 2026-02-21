#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";
import { inferRunnableFromOutPath } from "../../lib/runnables.ts";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

async function httpGet(
  url: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function pickFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  server.close();
  if (!addr || typeof addr !== "object" || typeof addr.port !== "number") {
    throw new Error("failed to reserve an ephemeral port");
  }
  return addr.port;
}

function sanitizeImporterForNixAttr(importer: string): string {
  return importer
    .replace(/\/\//g, "")
    .replace(/:/g, "-")
    .replace(/[\/\s]+/g, "-");
}

async function installNodeModules(appAbs: string, _$: any): Promise<void> {
  await _$({
    cwd: appAbs,
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
  })`pnpm install --frozen-lockfile --ignore-workspace --reporter=append-only`;
}

async function buildSsrWebappOutPath(
  tmp: string,
  importer: string,
  lockfile: string,
  _$: any,
): Promise<string> {
  const env = { ...process.env, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<string, string>;
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env,
  })`zx-wrapper build-tools/tools/dev/update-pnpm-hash.ts --lockfile ${lockfile}`;
  const attr = sanitizeImporterForNixAttr(importer);
  const built = await _$({
    cwd: tmp,
    stdio: "pipe",
    env,
  })`bash --noprofile --norc -c ${`set -euo pipefail; nix build "${tmp}#node-webapp.${attr}" --impure --no-link --accept-flake-config --builders "" --print-build-logs --print-out-paths`}`;
  return (
    String(built.stdout || "")
      .trim()
      .split("\n")
      .pop() || ""
  );
}

async function runNodeServerSmoke(
  appRoot: string,
  expectedMarker: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  const port = await pickFreePort();
  const serverEntry = path.join(appRoot, "dist", "server", "index.js");
  const child = spawn("node", [serverEntry], {
    cwd: appRoot,
    stdio: "pipe",
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "" },
  });
  let stderrText = "";
  child.stderr?.on("data", (chunk) => {
    stderrText += String(chunk || "");
  });
  try {
    const start = Date.now();
    while (Date.now() - start < 90000) {
      if (child.exitCode != null) {
        throw new Error(
          `server exited before readiness (code=${child.exitCode}). stderr:\n${stderrText.trim()}`,
        );
      }
      try {
        const res = await httpGet(`http://127.0.0.1:${port}/`);
        if (res.status === 200 && res.body.includes(expectedMarker)) return res;
      } catch {}
      await sleep(500);
    }
    throw new Error(`server did not return expected marker within 90000ms\n${stderrText.trim()}`);
  } finally {
    try {
      if (child.pid) child.kill("SIGINT");
    } catch {}
    try {
      await Promise.race([once(child, "exit"), sleep(5000)]);
    } catch {}
    if (child.exitCode == null) {
      try {
        if (child.pid) child.kill("SIGKILL");
      } catch {}
      try {
        await Promise.race([once(child, "exit"), sleep(2000)]);
      } catch {}
    }
  }
}

async function scaffoldBuildAndSmoke(
  tmp: string,
  appName: string,
  template: "webapp-ssr-express" | "webapp-ssr-next",
  framework: "express" | "next",
  marker: string,
  runRuntimeSmoke: boolean,
  _$: any,
): Promise<void> {
  const importer = path.join("projects", "apps", appName);
  const appAbs = path.join(tmp, importer);
  const $ = _$({ cwd: tmp, stdio: "inherit" });
  await $`scaf new node ${template} ${appName} --yes --no-tests`;
  await _$({
    cwd: appAbs,
    env: { ...process.env },
    stdio: "inherit",
  })`zx-wrapper ../../../build-tools/tools/dev/install/deps-main.ts --verbose --glue-only`;
  await _$({
    cwd: tmp,
    stdio: "pipe",
  })`git add -A ${importer} build-tools/tools/nix/node-modules.hashes.json build-tools/tools/nix/langs.nix build-tools/lang/importer_roots.bzl build-tools/tools/buck third_party/providers`;

  const outPath = await buildSsrWebappOutPath(
    tmp,
    importer,
    path.join(importer, "pnpm-lock.yaml"),
    _$,
  );
  if (!outPath) throw new Error(`nix build returned empty outPath for ${template}`);

  const serverEntry = path.join(outPath, "dist", "server", "index.js");
  const clientDir = path.join(outPath, "dist", "client");
  const clientWasmRoot = framework === "next" ? path.join(clientDir, "public") : clientDir;
  if (!(await exists(serverEntry))) throw new Error(`missing serverEntry artifact: ${serverEntry}`);
  if (!(await exists(clientDir))) throw new Error(`missing clientDir artifact: ${clientDir}`);
  const stagedWasm = path.join(clientWasmRoot, "top.wasm");
  if (!(await exists(stagedWasm)))
    throw new Error(`missing staged client wasm artifact: ${stagedWasm}`);
  const serverWasmCandidates = [
    path.join(outPath, "dist", "server", "wasm-contract", "top.wasm"),
    path.join(clientDir, "top.wasm"),
    path.join(clientDir, "public", "top.wasm"),
  ];
  let foundServerWasm = false;
  for (const candidate of serverWasmCandidates) {
    if (await exists(candidate)) {
      foundServerWasm = true;
      break;
    }
  }
  if (!foundServerWasm) {
    throw new Error(
      `missing server runtime wasm asset candidates: ${serverWasmCandidates.join(", ")}`,
    );
  }
  const inlineModule = path.join(clientWasmRoot, "wasm-inline", "index.js");
  if (!(await exists(inlineModule))) {
    throw new Error(`missing staged client inline wasm module: ${inlineModule}`);
  }
  if (template == "webapp-ssr-express") {
    const clientSource = await fsp.readFile(path.join(appAbs, "src", "wasm-contract.ts"), "utf8");
    assert.match(clientSource, /\/top\.wasm/);
    assert.match(clientSource, /\/wasm-inline\/index\.js/);
  }

  const runnable = await inferRunnableFromOutPath({
    label: "//projects/apps/demo-ssr:app",
    outPath,
    importer,
    mode: "ssr",
    framework,
  });
  assert.ok(runnable, "expected runnable contract for SSR output");
  assert.equal(runnable?.kind, "webapp-ssr");
  assert.equal(runnable?.framework, framework);
  assert.deepEqual(runnable?.run.prod.argv, ["node", serverEntry]);
  assert.deepEqual(runnable?.run.dev?.argv, ["pnpm", "--dir", importer, "dev:ssr"]);

  if (runRuntimeSmoke) {
    await installNodeModules(appAbs, _$);
    await fsp.rm(path.join(appAbs, "dist"), { recursive: true, force: true });
    await fsp.cp(path.join(outPath, "dist"), path.join(appAbs, "dist"), { recursive: true });
    const res = await runNodeServerSmoke(appAbs, marker);
    assert.equal(res.status, 200);
    const serverWasmHeader = Number(String(res.headers["x-server-wasm-bytes"] || "0"));
    assert.ok(serverWasmHeader > 0, "expected x-server-wasm-bytes header from server wasm path");
  }
}

test(
  "node SSR templates: scaffold, build via Nix, and run canonical node server entry",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const prevRoots = process.env.TEST_RSYNC_ROOTS;
    if (!prevRoots) {
      process.env.TEST_RSYNC_ROOTS =
        "build-tools toolchains third_party/providers prelude patches docs METHODOLOGY.XML AI-PREFERENCES.XML";
    }
    try {
      await runInTemp("node-webapp-ssr-scaffold-build", async (tmp, _$) => {
        await scaffoldBuildAndSmoke(
          tmp,
          "demo-ssr-express",
          "webapp-ssr-express",
          "express",
          'data-ssr-marker="express"',
          true,
          _$,
        );
        await scaffoldBuildAndSmoke(
          tmp,
          "demo-ssr-next",
          "webapp-ssr-next",
          "next",
          'data-ssr-marker="next"',
          true,
          _$,
        );
      });
    } finally {
      if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
      else process.env.TEST_RSYNC_ROOTS = prevRoots;
    }
  },
);
