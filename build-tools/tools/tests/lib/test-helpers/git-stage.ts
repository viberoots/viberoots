import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NIX_ATTR_MAP_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  DEFAULT_PROVIDER_TARGETS_PATH,
  WORKSPACE_BUCK_STATE_DIR,
  WORKSPACE_PROVIDER_DIR,
  providerAutoTargetsPath,
} from "../../../lib/workspace-state-paths";

const EXCLUDED_DIR_NAMES = new Set([
  ".cache",
  ".direnv",
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "buck-out",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const DEFAULT_TEMP_REPO_GLUE_STAGE_PATHS = [
  "build-tools/lang/importer_roots.bzl",
  "build-tools/lang/nix_attr_aliases.bzl",
  path.join(WORKSPACE_BUCK_STATE_DIR, ".buckconfig"),
  path.join(WORKSPACE_BUCK_STATE_DIR, "TARGETS"),
  path.join(WORKSPACE_BUCK_STATE_DIR, "workspace-root.env"),
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  path.join(WORKSPACE_PROVIDER_DIR, ".buckconfig"),
  DEFAULT_PROVIDER_TARGETS_PATH,
  providerAutoTargetsPath("cpp"),
  providerAutoTargetsPath("node"),
  providerAutoTargetsPath("python"),
  providerAutoTargetsPath("rust"),
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_NIX_ATTR_MAP_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  "build-tools/tools/buck/invalidation-report.txt",
  "build-tools/tools/buck/node-lock-index.json",
  "build-tools/tools/node/workspace-map.json",
  "build-tools/tools/nix/langs.nix",
  "build-tools/tools/nix/node-modules.hashes.json",
] as const;

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function shouldSkipEntry(name: string): boolean {
  return (
    EXCLUDED_DIR_NAMES.has(name) ||
    name === ".wasm-producer" ||
    name === ".DS_Store" ||
    name === "result" ||
    name.startsWith("result-")
  );
}

async function collectStageableFiles(absPath: string, relPath: string): Promise<string[]> {
  const st = await fsp.lstat(absPath).catch(() => null);
  if (!st) return [];
  if (st.isSymbolicLink() || st.isFile()) {
    return [normalizeRelPath(relPath)];
  }
  if (!st.isDirectory()) return [];

  const entries = await fsp.readdir(absPath, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (shouldSkipEntry(entry.name)) continue;
    const childAbs = path.join(absPath, entry.name);
    const childRel = path.posix.join(normalizeRelPath(relPath), entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectStageableFiles(childAbs, childRel)));
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(normalizeRelPath(childRel));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export async function stageTempRepoPaths(opts: {
  tmp: string;
  _$: any;
  recursiveRoots?: string[];
  explicitPaths?: string[];
}): Promise<void> {
  const files = new Set<string>();
  for (const relRoot of opts.recursiveRoots || []) {
    const normalized = normalizeRelPath(relRoot);
    const absRoot = path.join(opts.tmp, normalized);
    for (const file of await collectStageableFiles(absRoot, normalized)) {
      files.add(file);
    }
  }
  for (const relPath of opts.explicitPaths || []) {
    const normalized = normalizeRelPath(relPath);
    const absPath = path.join(opts.tmp, normalized);
    const st = await fsp.lstat(absPath).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      for (const file of await collectStageableFiles(absPath, normalized)) {
        files.add(file);
      }
      continue;
    }
    if (st.isFile() || st.isSymbolicLink()) files.add(normalized);
  }

  const sorted = Array.from(files).sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return;

  const chunkSize = 128;
  for (let idx = 0; idx < sorted.length; idx += chunkSize) {
    const chunk = sorted.slice(idx, idx + chunkSize);
    await opts._$({
      cwd: opts.tmp,
      stdio: "pipe",
    })`git add -f -- ${chunk}`;
  }
}
