import { normalizeTargetLabel, packagePathFromLabel } from "../lib/labels.ts";

type GraphNodeRecord = Record<string, unknown>;

const SHARED_CPP_SNAPSHOT_ROOTS = ["build-tools", "prelude", "third_party", "toolchains", "types"];

const SHARED_CPP_SNAPSHOT_ROOT_FILES = [
  ".npmrc",
  "flake.lock",
  "flake.nix",
  "gomod2nix.toml",
  "package.json",
  "pnpm-lock.yaml",
];

export const FILTERED_FLAKE_RSYNC_EXCLUDES = [
  ".git",
  "node_modules",
  "buck-out",
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
  "pnpm-workspace.yaml",
  ".node_modules.lockfile-guard.*",
  "result",
  "result-*",
];

function isRecord(value: unknown): value is GraphNodeRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function graphNodeNameOf(node: GraphNodeRecord): string {
  return normalizeTargetLabel(String(node.name || "").trim());
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
    const normalized = String(rel || "")
      .trim()
      .replace(/^\/+/, "");
    if (!normalized) continue;
    ordered.add(normalized);
  }
  return [...ordered];
}

export function selectedCppSnapshotRsyncSources(relPaths: readonly string[]): string[] {
  return relPaths.map((relPath) => `./${relPath}`);
}
