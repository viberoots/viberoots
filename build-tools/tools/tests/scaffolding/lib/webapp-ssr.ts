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
import { formatRunnableLine, inferRunnableFromOutPath } from "../../../lib/runnables";
import { DEFAULT_GRAPH_PATH } from "../../../lib/workspace-state-paths";
import { prepareExactPnpmStore } from "../../../dev/update-pnpm-hash/exact-store";
import { terminateChildTree } from "../../lib/process-tree";
import {
  DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS,
  stageTempRepoPaths,
} from "../../lib/test-helpers/git-stage";

export const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

function viberootsDevTool(name: string, workspaceRoot = process.cwd()): string {
  return path.join(viberootsRoot(workspaceRoot), "build-tools", "tools", "dev", name);
}

function viberootsBuckTool(name: string, workspaceRoot = process.cwd()): string {
  return path.join(viberootsRoot(workspaceRoot), "build-tools", "tools", "buck", name);
}

function viberootsRoot(candidate: string): string {
  const root = path.resolve(candidate);
  const consumerRoot = path.join(root, "viberoots");
  if (
    fs.existsSync(path.join(consumerRoot, "flake.nix")) &&
    fs.existsSync(path.join(consumerRoot, "build-tools", "tools", "dev", "zx-init.mjs"))
  ) {
    return consumerRoot;
  }
  if (fs.existsSync(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))) return root;
  const envRoot = process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "";
  if (envRoot && path.resolve(envRoot) !== root) {
    const resolvedEnvRoot = path.resolve(envRoot);
    if (
      fs.existsSync(path.join(resolvedEnvRoot, "flake.nix")) &&
      fs.existsSync(path.join(resolvedEnvRoot, "build-tools", "tools", "dev", "zx-init.mjs"))
    ) {
      return resolvedEnvRoot;
    }
  }
  return consumerRoot;
}

function tempWorkspaceEnv(tmp: string, extra: Record<string, string> = {}): Record<string, string> {
  const root = viberootsRoot(tmp);
  return {
    ...process.env,
    WORKSPACE_ROOT: tmp,
    VIBEROOTS_ROOT: root,
    VIBEROOTS_SOURCE_ROOT: root,
    ZX_INIT: path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"),
    ...extra,
  };
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

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function withTempRoots<T>(run: () => Promise<T>): Promise<T> {
  const prevRoots = process.env.TEST_RSYNC_ROOTS;
  if (!prevRoots) {
    process.env.TEST_RSYNC_ROOTS = "viberoots";
  }
  try {
    return await run();
  } finally {
    if (prevRoots === undefined) delete process.env.TEST_RSYNC_ROOTS;
    else process.env.TEST_RSYNC_ROOTS = prevRoots;
  }
}

async function workspaceFlakeRef(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  const hasHidden = await fsp
    .access(hidden)
    .then(() => true)
    .catch(() => false);
  return hasHidden ? path.dirname(hidden) : root;
}

export async function scaffoldAndPrepareWorkspace(
  tmp: string,
  _$: any,
  template: "webapp-ssr-next" | "webapp-ssr-vite",
  name: string,
): Promise<void> {
  const appRel = path.join("projects", "apps", name).replace(/\\/g, "/");
  const graphJsonAbs = path.join(tmp, DEFAULT_GRAPH_PATH);
  const appLabel = `//${appRel}:app`;
  const $ = _$({ cwd: tmp, stdio: "inherit", env: tempWorkspaceEnv(tmp) });
  await $`scaf new ts ${template} ${name} --yes --no-tests --skip-lockfile-gen`;
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [appRel],
  });
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: tempWorkspaceEnv(tmp, { NIX_PNPM_ALLOW_GENERATE: "1" }),
  })`zx-wrapper ${viberootsDevTool("update-pnpm-hash.ts", tmp)} --lockfile ${`${appRel}/pnpm-lock.yaml`}`;
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [appRel],
    explicitPaths: ["projects/node-modules.hashes.json"],
  });
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: tempWorkspaceEnv(tmp, { BUCK_TARGET: appLabel }),
  })`zx-wrapper ${viberootsDevTool("install/deps-main.ts", tmp)} --verbose --glue-only`;
  await fsp.rm(graphJsonAbs, { force: true });
  await _$({
    cwd: tmp,
    stdio: "inherit",
    env: tempWorkspaceEnv(tmp, { BUCK_TEST_SRC: tmp, BUCK_TARGET: appLabel }),
  })`zx-wrapper ${viberootsBuckTool("export-graph.ts", tmp)} --out ${graphJsonAbs}`;
  // deps-main --glue-only is the single authoritative glue path for this flow.
  await fsp.access(graphJsonAbs);
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [appRel],
    explicitPaths: [...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS],
  });
}

export async function buildSelectedSsr(
  tmp: string,
  _$: any,
  label: string,
  framework: "express" | "next" | "vite",
): Promise<{ outPath: string; importer: string }> {
  const graphJson = path.join(tmp, DEFAULT_GRAPH_PATH);
  const importer = label.replace(/^\/\//, "").replace(/:app$/, "");
  await stageTempRepoPaths({
    tmp,
    _$,
    recursiveRoots: [importer],
    explicitPaths: [...DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS, "projects/node-modules.hashes.json"],
  });
  const flakeRef = await workspaceFlakeRef(tmp);
  const exactStore = await prepareExactPnpmStore({ repoRoot: tmp, importer });
  const built = await _$({
    cwd: tmp,
    stdio: "pipe",
    env: tempWorkspaceEnv(tmp, {
      BUCK_TEST_SRC: tmp,
      NIX_PNPM_ALLOW_GENERATE: "1",
      NIX_PNPM_EXACT_STORE: exactStore.exactStorePath,
      BUCK_GRAPH_JSON: graphJson,
      BUCK_TARGET: label,
    }),
  })`bash --noprofile --norc -c ${`set -euo pipefail; nix build "path:${flakeRef}#graph-generator-pure-selected" --impure --no-link --no-write-lock-file --accept-flake-config --builders "" --print-build-logs --print-out-paths`}`;
  const outPath =
    String(built.stdout || "")
      .trim()
      .split("\n")
      .pop() || "";
  assert.ok(outPath, `expected selected graph out path for ${label}`);

  const runnable = await inferRunnableFromOutPath({
    label,
    outPath,
    importer,
    mode: "ssr",
    framework,
  });
  assert.ok(runnable, `missing runnable contract for ${label}`);
  assert.equal(runnable?.kind, "webapp-ssr");
  assert.equal(runnable?.framework, framework);
  assert.equal(runnable?.run.prod.argv[0], "node");
  const clientContractRoot =
    framework === "next"
      ? path.join(outPath, "dist", "client", "public")
      : path.join(outPath, "dist", "client");
  const topWasmPath = path.join(clientContractRoot, "top.wasm");
  const hasTopWasm = await fsp
    .stat(topWasmPath)
    .then((st) => st.isFile())
    .catch(() => false);
  if (hasTopWasm) {
    await fsp.access(path.join(clientContractRoot, "wasm-inline", "index.js"));
  }
  const line = formatRunnableLine({ label, runnable } as any);
  assert.ok(line.includes(label));
  assert.ok(line.includes("[webapp-ssr]"));
  assert.ok(line.includes("node "));
  return { outPath, importer };
}

export async function runExpressDockerSmoke(
  runtimeRoot: string,
  marker: string,
  expectedHtmlFragments: string[] = [],
): Promise<void> {
  const port = await pickFreePort();
  const child = spawn("node", ["dist/server/index.js"], {
    cwd: runtimeRoot,
    stdio: "pipe",
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "" },
  });
  let stderrText = "";
  child.stderr?.on("data", (chunk) => {
    stderrText += String(chunk || "");
  });
  try {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      if (child.exitCode != null) {
        throw new Error(
          `runtime smoke exited early (code=${child.exitCode})\n${stderrText.trim() || "(no stderr)"}`,
        );
      }
      try {
        const res = await httpGet(`http://127.0.0.1:${port}/`);
        const hasAllExpected = expectedHtmlFragments.every((fragment) =>
          res.body.includes(fragment),
        );
        if (res.status === 200 && res.body.includes(marker) && hasAllExpected) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`runtime smoke did not serve expected marker\n${stderrText.trim()}`);
  } finally {
    await terminateChildTree(child, 5000);
    try {
      if (child.exitCode == null) await Promise.race([once(child, "exit"), sleep(500)]);
    } catch {}
  }
}
