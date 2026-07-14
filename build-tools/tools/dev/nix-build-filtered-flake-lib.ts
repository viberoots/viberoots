import { normalizeTargetLabel, packagePathFromLabel } from "../lib/labels";

type GraphNodeRecord = Record<string, unknown>;

// prettier-ignore
const SHARED_CPP_SNAPSHOT_ROOTS = [".viberoots", "build-tools", "prelude", "third_party", "toolchains", "types", "viberoots"];

// prettier-ignore
const SHARED_CPP_SNAPSHOT_ROOT_FILES = [".npmrc", "flake.lock", "flake.nix", "gomod2nix.toml", "package.json", "pnpm-lock.yaml"];

const SHARED_NODE_SNAPSHOT_ROOTS = SHARED_CPP_SNAPSHOT_ROOTS;
const SHARED_NODE_SNAPSHOT_ROOT_FILES = [
  ...SHARED_CPP_SNAPSHOT_ROOT_FILES,
  "pnpm-workspace.yaml",
  "projects/node-modules.hashes.json",
];

// prettier-ignore
export const DEFAULT_FILTERED_FLAKE_ROOT_FILES = [".buckconfig", ".buckroot", ".npmrc", "TARGETS", "eslint.config.js", "flake.lock", "flake.nix", "gomod2nix.toml", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json"];

// prettier-ignore
export const DEFAULT_FILTERED_FLAKE_ROOTS = [".viberoots", "build-tools", "cpp", "go", "lang", "node", "patches", "prelude", "python", "tools", "third_party", "toolchains", "types", "viberoots"];

export const FILTERED_FLAKE_RSYNC_EXCLUDES = [
  ".git",
  "node_modules",
  "buck-out",
  ".codex-logs",
  ".codex-*.log",
  ".full-test-output.log",
  ".patch-sessions.json",
  "test-logs",
  "/backups",
  "/cache",
  "/codex-test-logs",
  "/install-cache",
  "/nix-xdg-cache",
  "/pr-logs",
  "/viberoots-flake-input",
  "/xdg-cache",
  ".viberoots/buck",
  ".viberoots/buck/tmp",
  ".viberoots/cache",
  ".viberoots/codex-logs",
  ".viberoots/codex-test-logs",
  ".viberoots/current",
  ".viberoots/workspace/.viberoots",
  ".viberoots/workspace/backups",
  ".viberoots/workspace/buck",
  ".viberoots/workspace/cache",
  ".viberoots/workspace/codex-test-logs",
  ".viberoots/workspace/exact-env-smoke.out",
  ".viberoots/workspace/host-path",
  ".viberoots/workspace/install-cache",
  ".viberoots/workspace/nix-xdg-cache",
  ".viberoots/workspace/node",
  ".viberoots/workspace/prelude",
  ".viberoots/workspace/pr-logs",
  ".viberoots/workspace/viberoots-flake-input",
  ".viberoots/workspace/xdg-cache",
  "viberoots/.viberoots",
  "viberoots/backups",
  "viberoots/cache",
  "viberoots/codex-test-logs",
  "viberoots/install-cache",
  "viberoots/nix-xdg-cache",
  "viberoots/pr-logs",
  "viberoots/xdg-cache",
  "viberoots/.cache",
  "viberoots/.clinic",
  "viberoots/.codex-logs",
  "viberoots/.codex-*.log",
  "viberoots/.direnv",
  "viberoots/.full-test-output.log",
  "viberoots/.nix-gcroots",
  "viberoots/.patch-sessions.json",
  "viberoots/.pnpm-store",
  "viberoots/buck-out",
  "viberoots/build-tools/tmp",
  "viberoots/coverage",
  "viberoots/node_modules",
  "viberoots/prelude",
  "viberoots/result",
  "viberoots/result-*",
  "viberoots/test-logs",
  ".direnv",
  ".pnpm-store",
  ".pnpm-home",
  "coverage",
  ".clinic",
  ".turbo",
  ".cache",
  "dist",
  "build",
  ".vite",
  ".next",
  ".wasm-producer",
  ".node_modules.lockfile-guard.*",
  ".*.tmp",
  ".*.ts.??????",
  ".*.tsx.??????",
  ".*.js.??????",
  ".*.mjs.??????",
  "result",
  "result-*",
];

export function filteredFlakeRsyncExcludeArgs(): string[] {
  return FILTERED_FLAKE_RSYNC_EXCLUDES.map((entry) => ["--exclude", entry]).flat();
}

export function defaultFilteredFlakeSnapshotRelPaths(): string[] {
  return [...DEFAULT_FILTERED_FLAKE_ROOT_FILES, ...DEFAULT_FILTERED_FLAKE_ROOTS];
}

export function defaultFilteredFlakeSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}

function isRecord(value: unknown): value is GraphNodeRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function graphNodeNameOf(node: GraphNodeRecord): string {
  return normalizeTargetLabel(String(node.name || "").trim());
}

function normalizeRelPath(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function graphNodeDepsOf(node: GraphNodeRecord): string[] {
  const raw = node.deps;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => normalizeTargetLabel(String(value || "").trim()))
    .filter((value) => value.length > 0);
}

export function graphNodesFromJson(raw: unknown): GraphNodeRecord[] {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord);
  }
  if (isRecord(raw) && Array.isArray(raw.nodes)) {
    return raw.nodes.filter(isRecord);
  }
  if (!isRecord(raw)) return [];
  return Object.entries(raw).map(([name, value]) => {
    if (isRecord(value)) {
      return { ...value, name: value.name ?? name };
    }
    return { name };
  });
}

export function computeSelectedCppPackageClosure(
  nodes: readonly GraphNodeRecord[],
  target: string,
): string[] {
  const want = normalizeTargetLabel(target);
  if (!want) return [];
  const byName = new Map<string, GraphNodeRecord>();
  for (const node of nodes) {
    const name = graphNodeNameOf(node);
    if (!name) continue;
    byName.set(name, node);
  }
  const seen = new Set<string>();
  const packages = new Set<string>();
  const pending = [want];
  while (pending.length > 0) {
    const name = pending.pop() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const pkg = packagePathFromLabel(name);
    if (pkg) packages.add(pkg);
    const node = byName.get(name);
    if (!node) continue;
    for (const dep of graphNodeDepsOf(node)) {
      pending.push(dep);
    }
  }
  return [...packages].sort();
}

export function selectedCppSnapshotRelPaths(packagePaths: readonly string[]): string[] {
  const ordered = new Set<string>();
  for (const rel of SHARED_CPP_SNAPSHOT_ROOT_FILES) ordered.add(rel);
  for (const rel of SHARED_CPP_SNAPSHOT_ROOTS) ordered.add(rel);
  for (const rel of packagePaths) {
    const normalized = normalizeRelPath(rel);
    if (!normalized) continue;
    ordered.add(normalized);
  }
  return [...ordered];
}

export function selectedCppSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}

export function selectedNodeSnapshotRelPaths(
  importerDir: string,
  workspacePackageDirs: readonly string[] = [],
): string[] {
  const ordered = new Set<string>();
  for (const rel of SHARED_NODE_SNAPSHOT_ROOT_FILES) ordered.add(rel);
  for (const rel of SHARED_NODE_SNAPSHOT_ROOTS) ordered.add(rel);
  const normalized = normalizeRelPath(importerDir);
  if (!normalized || normalized === ".") return [...ordered];
  ordered.add(normalized);
  for (const rel of workspacePackageDirs) {
    const workspacePackage = normalizeRelPath(rel);
    if (workspacePackage && workspacePackage !== ".") ordered.add(workspacePackage);
  }
  const name = normalized.split("/").pop() || "";
  if (name) {
    ordered.add(`${normalized}-native`);
    ordered.add(`projects/libs/${name}-go`);
  }
  return [...ordered];
}

export function selectedNodeSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}

export function selectedPythonSnapshotRelPaths(importerDir: string): string[] {
  const ordered = new Set<string>();
  for (const rel of SHARED_CPP_SNAPSHOT_ROOT_FILES) ordered.add(rel);
  for (const rel of SHARED_CPP_SNAPSHOT_ROOTS) ordered.add(rel);
  const normalized = normalizeRelPath(importerDir);
  if (normalized && normalized !== ".") ordered.add(normalized);
  return [...ordered];
}

export function selectedPythonSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}
