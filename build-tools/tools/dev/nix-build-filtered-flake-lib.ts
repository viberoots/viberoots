export * from "./nix-build-filtered-flake-filters";
export * from "./nix-build-filtered-flake-graph";

// prettier-ignore
const SHARED_CPP_SNAPSHOT_ROOTS = [".viberoots", "build-tools", "third_party", "toolchains", "types", "viberoots"];

// prettier-ignore
const SHARED_CPP_SNAPSHOT_ROOT_FILES = [".npmrc", "flake.lock", "flake.nix", "gomod2nix.toml", "package.json", "pnpm-lock.yaml"];

const SHARED_NODE_SNAPSHOT_ROOTS = SHARED_CPP_SNAPSHOT_ROOTS;
const SHARED_NODE_SNAPSHOT_ROOT_FILES = [
  ...SHARED_CPP_SNAPSHOT_ROOT_FILES,
  "pnpm-workspace.yaml",
  "projects/config/node-modules.hashes.json",
];

function normalizeRelPath(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
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
