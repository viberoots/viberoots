#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { inferRunnableFromOutPath } from "../../lib/runnables";
import { parseWasmModuleManifest } from "../../scaffolding/webapp-module-manifests";
import { terminateChildTree } from "./process-tree";
import { DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS, stageTempRepoPaths } from "./test-helpers/git-stage";
import { exists } from "./test-helpers";
import { pnpmInstallForDevTest } from "../scaffolding/lib/dev-node-modules";

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

function viberootsDevTool(name: string): string {
  const root = process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || process.cwd();
  const resolvedRoot = path.resolve(root);
  const viberootsRoot = fs.existsSync(
    path.join(resolvedRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
  )
    ? resolvedRoot
    : path.join(resolvedRoot, "viberoots");
  return path.join(viberootsRoot, "build-tools", "tools", "dev", name);
}

async function readCanonicalServerWasmArtifact(outPath: string): Promise<string | null> {
  const manifestPath = path.join(outPath, "dist", "server", "wasm-modules.manifest.json");
  const manifest = parseWasmModuleManifest(
    JSON.parse(await fsp.readFile(manifestPath, "utf8")),
    manifestPath,
  );
  if (manifest.modules.length === 0 || manifest.defaultModuleKey === "") {
    return null;
  }
  const defaultEntry = manifest.modules.find(
    (entry) => entry.moduleKey === manifest.defaultModuleKey,
  );
  if (!defaultEntry) {
    throw new Error(
      `missing default wasm module '${manifest.defaultModuleKey}' in generated manifest: ${manifestPath}`,
    );
  }
  return path.join(outPath, "dist", ...defaultEntry.runtimeDestinations.server.split("/"));
}

async function workspaceFlakeRef(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  const hasHidden = await fsp
    .access(hidden)
    .then(() => true)
    .catch(() => false);
  return hasHidden ? path.dirname(hidden) : root;
}

async function buildSsrWebappOutPath(
  tmp: string,
  importer: string,
  lockfile: string,
  _$: any,
): Promise<string> {
  const env = { ...process.env, WORKSPACE_ROOT: tmp, NIX_PNPM_ALLOW_GENERATE: "1" } as Record<
    string,
    string
  >;
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env,
  })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts")} --lockfile ${lockfile}`;
  await stageTempRepoPaths({
    tmp,
    _$,
    explicitPaths: ["projects/config/node-modules.hashes.json"],
  });
  const attr = sanitizeImporterForNixAttr(importer);
  const flakeRef = await workspaceFlakeRef(tmp);
  const built = await _$({
    cwd: tmp,
    stdio: "pipe",
    env,
  })`bash --noprofile --norc -c ${`set -euo pipefail; nix build "path:${flakeRef}#node-webapp.${attr}" --impure --no-link --accept-flake-config --builders "" --print-build-logs --print-out-paths`}`;
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
    await terminateChildTree(child, 5000);
    try {
      if (child.exitCode == null) await Promise.race([once(child, "exit"), sleep(500)]);
    } catch {}
  }
}

export async function scaffoldBuildAndSmoke(
  tmp: string,
  appName: string,
  template: "webapp-ssr-next" | "webapp-ssr-vite",
  framework: "next" | "vite",
  marker: string,
  runRuntimeSmoke: boolean,
  _$: any,
): Promise<void> {
  const importer = path.join("projects", "apps", appName);
  const appAbs = path.join(tmp, importer);
  const $ = _$({ cwd: tmp, stdio: "inherit" });
  await $`scaf new ts ${template} ${appName} --yes --no-tests`;
  await _$({
    cwd: appAbs,
    env: { ...process.env, WORKSPACE_ROOT: tmp },
    stdio: "inherit",
  })`zx-wrapper ${viberootsDevTool("install/deps-main.ts")} --verbose --glue-only`;
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [importer],
    explicitPaths: [...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS],
  });
  const outPath = await buildSsrWebappOutPath(
    tmp,
    importer,
    path.join(importer, "pnpm-lock.yaml"),
    _$,
  );
  if (!outPath) throw new Error(`nix build returned empty outPath for ${template}`);

  const serverEntry = path.join(outPath, "dist", "server", "index.js");
  const clientDir = path.join(outPath, "dist", "client");
  if (!(await exists(serverEntry))) throw new Error(`missing serverEntry artifact: ${serverEntry}`);
  if (!(await exists(clientDir))) throw new Error(`missing clientDir artifact: ${clientDir}`);
  const clientWasmRoot = framework === "next" ? path.join(clientDir, "public") : clientDir;
  const stagedWasm = path.join(clientWasmRoot, "top.wasm");
  if (!(await exists(stagedWasm))) {
    throw new Error(`missing staged client wasm artifact: ${stagedWasm}`);
  }
  const serverWasmContract = await readCanonicalServerWasmArtifact(outPath);
  if (serverWasmContract && !(await exists(serverWasmContract))) {
    throw new Error(`missing canonical server runtime wasm asset: ${serverWasmContract}`);
  }
  const inlineModule = path.join(clientWasmRoot, "wasm-inline", "index.js");
  if (!(await exists(inlineModule))) {
    throw new Error(`missing staged client inline wasm module: ${inlineModule}`);
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

  if (!runRuntimeSmoke) return;
  await pnpmInstallForDevTest({
    tmp,
    _$,
    filter: `./${importer}...`,
    frozenLockfile: true,
  });
  await fsp.rm(path.join(appAbs, "dist"), { recursive: true, force: true });
  await fsp.cp(path.join(outPath, "dist"), path.join(appAbs, "dist"), { recursive: true });
  const res = await runNodeServerSmoke(appAbs, marker);
  assert.equal(res.status, 200);
  const serverWasmHeader = Number(String(res.headers["x-server-wasm-bytes"] || "0"));
  assert.ok(serverWasmHeader > 0, "expected x-server-wasm-bytes header from server wasm path");
}
