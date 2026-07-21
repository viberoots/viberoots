#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildSelectedOutPath } from "../dev/run-runnable-graph";
import { canonicalArtifactToolsRoot } from "../lib/artifact-environment";

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

export async function findRepoRoot(start) {
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
    const parent = path.dirname(dir);
    if (path.basename(dir) === "viberoots" && (await isConsumerWorkspaceRoot(parent))) {
      return parent;
    }
    if (await isWorkspaceRoot(dir)) return dir;
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
  return await buildSelectedOutPath(repoRoot, target, "auto", {
    label: `export WASM target ${target}`,
    purpose: String(process.env.CI || "").trim() ? "ci" : "local",
    artifactToolsRoot: canonicalArtifactToolsRoot(repoRoot),
  });
}

export async function copyWasmArtifact(buildOut, subdir, name, exts, out) {
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
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.copyFile(path.join(wasmDir, matches[0]), out);
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
  await copyWasmArtifact(buildOut, subdir, name, exts, out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
