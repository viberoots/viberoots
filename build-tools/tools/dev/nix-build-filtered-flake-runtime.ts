import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { resolveFinalPnpmStore } from "./update-pnpm-hash/realized-store";
import { getImporterRootsContract } from "../lib/importer-roots";
import { sanitizeName } from "../lib/sanitize";
import { pnpmStoreAttrFromImporter } from "./update-pnpm-hash/paths";
import { runCommand } from "./filtered-flake-command";

async function pathExists(filePath: string): Promise<boolean> {
  return await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

export async function pnpmImportersFromAttrs(root: string, attr: string): Promise<string[]> {
  const { workspaceRoots } = getImporterRootsContract();
  const out: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const absRoot = path.join(root, workspaceRoot);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(absRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const importer = path.posix.join(workspaceRoot, entry.name);
      if (sanitizeName(importer) !== attr.split(".").at(-1)) continue;
      if (!(await pathExists(path.join(root, importer, "pnpm-lock.yaml")))) continue;
      out.push(importer);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export async function prewarmFinalStoreForTarget(
  root: string,
  commandCwd: string,
  attr: string,
  flakeRef: string,
  env: NodeJS.ProcessEnv,
): Promise<{ env: Record<string, string>; cleanup: () => Promise<void> }> {
  const targetImporter = targetPackageFromLabel(String(process.env.BUCK_TARGET || ""));
  const attrImporters = await pnpmImportersFromAttrs(root, attr);
  const importer = targetImporter || attrImporters[0] || "";
  if (!importer || !(await pathExists(path.join(root, importer, "pnpm-lock.yaml")))) {
    return { env: {}, cleanup: async () => {} };
  }
  const prepared = await resolveFinalPnpmStore({
    repoRoot: root,
    commandCwd,
    importer,
    flakeRef,
    attrPath: pnpmStoreAttrFromImporter(importer),
    env,
  });
  return {
    env: {},
    cleanup: prepared.cleanup,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(1);
  return `${mins}m${secs}s`;
}

export function readInt(value: unknown): number {
  const n = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export async function readSnapshotStats(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ fileCount: number; dirCount: number; kb: number }> {
  const [{ stdout: files }, { stdout: dirs }, { stdout: kb }] = await Promise.all([
    runCommand({
      command: ensureNixStoreToolPathSync("find", env),
      args: [dir, "-type", "f"],
      env,
    }),
    runCommand({
      command: ensureNixStoreToolPathSync("find", env),
      args: [dir, "-type", "d"],
      env,
    }),
    runCommand({
      command: ensureNixStoreToolPathSync("du", env),
      args: ["-sk", dir],
      env,
    }),
  ]);
  return {
    fileCount: String(files).trim().split(/\n/).filter(Boolean).length,
    dirCount: String(dirs).trim().split(/\n/).filter(Boolean).length,
    kb: readInt(String(kb || "").split(/\s+/)[0]),
  };
}
