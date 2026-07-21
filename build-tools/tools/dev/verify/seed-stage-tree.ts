import * as fsp from "node:fs/promises";
import path from "node:path";
import { GENERATED_REPO_STATE_PATHS } from "../../lib/generated-repo-state";
import { PREPARED_MARKER } from "./seed-stage-layout";

const REQUIRED_STAGE_FILES = [
  path.join(".viberoots", "workspace", "flake.nix"),
  ".buckconfig",
  path.join("viberoots", "eslint.config.js"),
  path.join("viberoots", "build-tools", "deployments", "defs.bzl"),
  path.join("viberoots", "build-tools", "tools", "buck", "export-graph.ts"),
  path.join("viberoots", "build-tools", "tools", "dev", "zx-init.mjs"),
  path.join("viberoots", "build-tools", "tools", "node", "gen-wasm-inline-module.ts"),
  path.join("viberoots", "flake.nix"),
];

export async function ensureWritableTree(root: string): Promise<void> {
  const rootSt = await fsp.stat(root).catch(() => null);
  if (rootSt) await fsp.chmod(root, rootSt.mode | 0o700).catch(() => {});
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) await fsp.chmod(abs, st.mode | 0o200).catch(() => {});
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) {
        const st = await fsp.stat(abs).catch(() => null);
        if (st) await fsp.chmod(abs, st.mode | 0o200).catch(() => {});
      }
    }
  }
}

export async function removeWritableTree(root: string): Promise<void> {
  await ensureWritableTree(root).catch(() => {});
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
}

async function missingRequiredStageFiles(root: string): Promise<string[]> {
  const missing: string[] = [];
  for (const rel of REQUIRED_STAGE_FILES) {
    const ok = await fsp
      .access(path.join(root, rel))
      .then(() => true)
      .catch(() => false);
    if (!ok) missing.push(rel);
  }
  return missing;
}

async function hasGeneratedRepoState(root: string): Promise<boolean> {
  for (const rel of GENERATED_REPO_STATE_PATHS) {
    const exists = await fsp
      .access(path.join(root, rel))
      .then(() => true)
      .catch(() => false);
    if (exists) return true;
  }
  return false;
}

export async function stageReady(stageDir: string, seedKey: string): Promise<boolean> {
  const existingKey = await fsp.readFile(path.join(stageDir, "seed.key"), "utf8").catch(() => "");
  if (existingKey.trim() !== seedKey) return false;
  for (const marker of [".seed-store-ready", PREPARED_MARKER]) {
    const exists = await fsp
      .access(path.join(stageDir, marker))
      .then(() => true)
      .catch(() => false);
    if (!exists) return false;
  }
  if (await hasGeneratedRepoState(stageDir)) return false;
  return (await missingRequiredStageFiles(stageDir)).length === 0;
}
