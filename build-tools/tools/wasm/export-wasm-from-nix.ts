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
  const buckOutRoot = await findBuckOutWorkspaceRoot(start);
  if (buckOutRoot) return buckOutRoot;
  for (const envName of ["WORKSPACE_ROOT", "BUCK_TEST_SRC", "REPO_ROOT"]) {
    const envRoot = readEnv(envName);
    if (!envRoot) continue;
    const root = path.resolve(envRoot);
    const parent = path.dirname(root);
    if (path.basename(root) === "viberoots" && (await isConsumerWorkspaceRoot(parent))) {
      return parent;
    }
    if (await isConsumerWorkspaceRoot(root)) return root;
    if (await isWorkspaceRoot(root)) return root;
  }
  let dir = path.resolve(start);
  for (;;) {
    if (await isConsumerWorkspaceRoot(dir)) return dir;
    if (await isWorkspaceRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`workspace root not found from ${start}`);
}

async function findBuckOutWorkspaceRoot(start) {
  const dir = path.resolve(start);
  const parts = dir.split(path.sep);
  const buckOutIdx = parts.lastIndexOf("buck-out");
  if (buckOutIdx <= 0) return "";
  const candidate = parts.slice(0, buckOutIdx).join(path.sep) || path.sep;
  if (await isConsumerWorkspaceRoot(candidate)) return path.resolve(candidate);
  if (await isWorkspaceRoot(candidate)) return path.resolve(candidate);
  return "";
}

async function isConsumerWorkspaceRoot(dir) {
  return (
    (await pathExists(path.join(dir, ".viberoots", "workspace", "flake.nix"))) &&
    (await pathExists(path.join(dir, "viberoots", "flake.nix")))
  );
}

async function isWorkspaceRoot(dir) {
  return (
    (await pathExists(path.join(dir, ".viberoots", "workspace", "flake.nix"))) ||
    (await pathExists(path.join(dir, "viberoots", "flake.nix"))) ||
    (await pathExists(path.join(dir, "flake.nix"))) ||
    (await pathExists(path.join(dir, ".buckroot")))
  );
}

async function findViberootsRoot(repoRoot) {
  const envRoot = readEnv("VIBEROOTS_ROOT");
  const candidates = [
    envRoot,
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    repoRoot,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (await pathExists(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"))) {
      return root;
    }
  }
  return repoRoot;
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
  const viberootsRoot = await findViberootsRoot(repoRoot);
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
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
        VIBEROOTS_ROOT: viberootsRoot,
        WORKSPACE_ROOT: repoRoot,
      },
    })`nix run --accept-flake-config ${`path:${viberootsRoot}#zx-wrapper`} -- ${path.join(
      viberootsRoot,
      "build-tools",
      "tools",
      "buck",
      "export-graph.ts",
    )} --out ${graphPath}`;
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

function normalizeTargetLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^root\/\//, "//")
    .replace(/\s+\(.*\)$/, "")
    .replace(/^\/\//, "");
}

async function readGraphNodes(graphPath) {
  const raw = JSON.parse(await fs.readFile(graphPath, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.nodes)) return raw.nodes;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([name, value]) =>
    value && typeof value === "object" && !Array.isArray(value) ? { ...value, name } : { name },
  );
}

async function isCppTarget(graphPath, target) {
  const want = normalizeTargetLabel(target);
  const nodes = await readGraphNodes(graphPath);
  const node = nodes.find((candidate) => normalizeTargetLabel(candidate?.name) === want);
  if (!node) {
    throw new Error(`graph ${graphPath} is missing WASM_TARGET ${target}`);
  }
  return Array.isArray(node.labels) && node.labels.includes("lang:cpp");
}

async function buildTarget(target) {
  const repoRoot = await findRepoRoot(process.cwd());
  const viberootsRoot = await findViberootsRoot(repoRoot);
  const filteredFlakeBuilder = path.join(
    viberootsRoot,
    "build-tools",
    "tools",
    "dev",
    "nix-build-filtered-flake.ts",
  );
  const graphPath =
    readEnv("BUCK_GRAPH_JSON") ||
    path.join(repoRoot, ".viberoots", "workspace", "buck", "graph.json");
  await ensureGraph(repoRoot, graphPath);
  const plannerOnlyCpp = await isCppTarget(graphPath, target);
  const buildEnv = {
    ...process.env,
    BUCK_TARGET: target,
    BUCK_GRAPH_JSON: graphPath,
    BUCK_TEST_SRC: repoRoot,
    ...(plannerOnlyCpp ? { PLANNER_ONLY_CPP: "1" } : {}),
    VIBEROOTS_ROOT: viberootsRoot,
    VIBEROOTS_SOURCE_ROOT: viberootsRoot,
    WORKSPACE_ROOT: repoRoot,
    EXPORTER_VALIDATION: readEnv("EXPORTER_VALIDATION") || "warn",
  };
  if (!plannerOnlyCpp) {
    delete buildEnv.PLANNER_ONLY_CPP;
  }
  const res = await $({
    stdio: "pipe",
    cwd: repoRoot,
    env: buildEnv,
  })`node --experimental-top-level-await --disable-warning=ExperimentalWarning --experimental-strip-types --import ${path.join(
    viberootsRoot,
    "build-tools",
    "tools",
    "dev",
    "zx-init.mjs",
  )} ${filteredFlakeBuilder} --attr graph-generator-selected`;
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
