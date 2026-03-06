#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (await pathExists(path.join(dir, "flake.nix"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`flake.nix not found from ${start}`);
}

async function acquireGraphLock(lockPath, graphPath) {
  const start = Date.now();
  for (;;) {
    if (await pathExists(graphPath)) return null;
    try {
      return await fs.open(lockPath, "wx");
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
    }
    if (Date.now() - start > 5 * 60 * 1000) {
      throw new Error(`timed out waiting for graph lock at ${lockPath}`);
    }
    await sleep(250);
  }
}

async function ensureGraph(repoRoot, graphPath) {
  if (await pathExists(graphPath)) return;
  const lockPath = `${graphPath}.lock`;
  const lockHandle = await acquireGraphLock(lockPath, graphPath);
  if (!lockHandle) return;
  try {
    await $({
      cwd: repoRoot,
      stdio: "pipe",
      env: {
        ...process.env,
        BUCK_TEST_SRC: repoRoot,
        WORKSPACE_ROOT: repoRoot,
      },
    })`nix run --accept-flake-config ${repoRoot}#zx-wrapper -- build-tools/tools/buck/export-graph.ts --out ${graphPath}`;
    if (!(await pathExists(graphPath))) {
      throw new Error(`graph.json not found at ${graphPath}`);
    }
  } finally {
    if (lockHandle) {
      await lockHandle.close();
    }
    await fs.rm(lockPath, { force: true });
  }
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function buildTarget(target) {
  const repoRoot = await findRepoRoot(process.cwd());
  const graphPath = path.join(repoRoot, "build-tools", "tools", "buck", "graph.json");
  await ensureGraph(repoRoot, graphPath);
  const res = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      BUCK_TARGET: target,
      BUCK_GRAPH_JSON: graphPath,
      BUCK_TEST_SRC: repoRoot,
      WORKSPACE_ROOT: repoRoot,
      EXPORTER_VALIDATION: readEnv("EXPORTER_VALIDATION") || "warn",
    },
  })`nix build --impure ${repoRoot}#graph-generator-selected --accept-flake-config --no-link --print-out-paths`;
  const outText = String(res.stdout || "").trim();
  const line = outText.split(/\n+/).pop() || "";
  if (!line) {
    throw new Error("nix build did not emit an output path");
  }
  return line;
}

function normalizeExts(value) {
  const raw = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return raw.length ? raw : [".wasm"];
}

async function main() {
  const target = readEnv("WASM_TARGET");
  const subdir = readEnv("WASM_DIR");
  const name = readEnv("WASM_NAME");
  const exts = normalizeExts(readEnv("WASM_EXTS"));
  const out = readEnv("OUT_PATH") || readEnv("OUT");
  if (!target || !subdir || !out) {
    throw new Error("missing WASM_TARGET, WASM_DIR, or OUT_PATH");
  }

  const buildOut = await buildTarget(target);
  const wasmDir = path.join(buildOut, subdir);
  const entries = await fs.readdir(wasmDir);
  const matches = entries
    .filter((entry) => {
      if (name && !entry.startsWith(name)) return false;
      return exts.some((ext) => entry.endsWith(ext));
    })
    .sort();
  if (matches.length === 0) {
    const label = name ? ` for ${name}` : "";
    throw new Error(`no wasm artifact under ${wasmDir}${label}`);
  }
  if (!name && matches.length > 1) {
    throw new Error(`multiple wasm artifacts under ${wasmDir}; set WASM_NAME to disambiguate`);
  }
  const hit = matches[0];
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.copyFile(path.join(wasmDir, hit), out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
