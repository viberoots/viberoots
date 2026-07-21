import path from "node:path";
import { normalizeTargetLabel, packagePathFromLabel } from "../lib/labels";

type GraphNodeRecord = Record<string, unknown>;

export type DeclaredProviderEdge = {
  actionPath: string;
  packagePath: string;
};

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

function selectedGraphNodes(nodes: readonly GraphNodeRecord[], target: string): GraphNodeRecord[] {
  const want = normalizeTargetLabel(target);
  if (!want) return [...nodes];
  const byName = new Map<string, GraphNodeRecord>();
  for (const node of nodes) {
    const name = graphNodeNameOf(node);
    if (name) byName.set(name, node);
  }
  const selected: GraphNodeRecord[] = [];
  const seen = new Set<string>();
  const pending = [want];
  while (pending.length > 0) {
    const name = pending.pop() || "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const node = byName.get(name);
    if (!node) continue;
    selected.push(node);
    pending.push(...graphNodeDepsOf(node));
  }
  return selected;
}

function graphNodeSourceValues(node: GraphNodeRecord): string[] {
  const raw = node.srcs;
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string");
  if (isRecord(raw)) {
    return Object.values(raw).filter((value): value is string => typeof value === "string");
  }
  return [];
}

function canonicalRootSourcePath(value: string): string | null {
  if (!value.startsWith("root///")) return null;
  const relative = value.slice("root///".length);
  const segments = relative.split("/");
  if (
    !relative ||
    relative.includes("\\") ||
    relative.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    path.posix.normalize(relative) !== relative
  ) {
    throw new Error(`invalid declared root source path in Buck graph: ${value}`);
  }
  return relative;
}

export function graphDeclaredRootSourcePaths(
  nodes: readonly GraphNodeRecord[],
  target = "",
): string[] {
  const paths = new Set<string>();
  for (const node of selectedGraphNodes(nodes, target)) {
    for (const value of graphNodeSourceValues(node)) {
      const relative = canonicalRootSourcePath(value);
      if (relative) paths.add(relative);
    }
  }
  return [...paths].sort();
}

export function graphDeclaredProviderEdges(
  nodes: readonly GraphNodeRecord[],
  target: string,
): DeclaredProviderEdge[] {
  const want = normalizeTargetLabel(target);
  const node = nodes.find((candidate) => graphNodeNameOf(candidate) === want);
  if (!node || !isRecord(node.srcs)) return [];
  const edges: DeclaredProviderEdge[] = [];
  for (const [actionPath, providerLabel] of Object.entries(node.srcs)) {
    if (!actionPath.startsWith("__provider_edges__/")) continue;
    if (typeof providerLabel !== "string") {
      throw new Error(`invalid declared provider label for Buck action input: ${actionPath}`);
    }
    const canonicalActionPath = canonicalRootSourcePath(`root///${actionPath}`);
    if (!canonicalActionPath) {
      throw new Error(`invalid declared provider edge in Buck graph: ${actionPath}`);
    }
    // Provider labels that resolve to a non-root cell (e.g. workspace_providers//:...)
    // have no in-tree package to materialize; the action path is already a declared
    // Buck input, so the downstream copy loop still stages it into the snapshot.
    const packagePath = packagePathFromLabel(providerLabel);
    let canonicalPackagePath: string | null = "";
    if (packagePath) {
      canonicalPackagePath = canonicalRootSourcePath(`root///${packagePath}`);
      if (!canonicalPackagePath) {
        throw new Error(`invalid declared provider edge in Buck graph: ${actionPath}`);
      }
    }
    edges.push({ actionPath: canonicalActionPath, packagePath: canonicalPackagePath });
  }
  return edges.sort((left, right) => left.actionPath.localeCompare(right.actionPath));
}

export function graphDeclaredActionInputPaths(
  nodes: readonly GraphNodeRecord[],
  target: string,
): string[] {
  const want = normalizeTargetLabel(target);
  const node = nodes.find((candidate) => graphNodeNameOf(candidate) === want);
  if (!node || !isRecord(node.srcs)) return [];
  const paths = new Set<string>();
  for (const actionPath of Object.keys(node.srcs)) {
    const canonical = canonicalRootSourcePath(`root///${actionPath}`);
    if (canonical) paths.add(canonical);
  }
  return [...paths].sort();
}

export function linkedWorkspacePackageName(
  lock: GraphNodeRecord,
  importerDir: string,
  packagePath: string,
): string {
  const importers = isRecord(lock.importers) ? lock.importers : {};
  const importer = isRecord(importers["."]) ? importers["."] : {};
  const matches = new Set<string>();
  for (const groupName of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const group = isRecord(importer[groupName]) ? importer[groupName] : {};
    for (const [name, rawRef] of Object.entries(group)) {
      const ref =
        typeof rawRef === "string"
          ? rawRef
          : isRecord(rawRef) && typeof rawRef.version === "string"
            ? rawRef.version
            : "";
      if (!ref.startsWith("link:")) continue;
      const linkedPath = path.posix.resolve("/", importerDir, ref.slice("link:".length)).slice(1);
      if (linkedPath === packagePath) matches.add(name);
    }
  }
  if (matches.size !== 1) {
    throw new Error(
      `expected one linked workspace package name for ${packagePath}; found ${matches.size}`,
    );
  }
  return [...matches][0];
}

export function graphNodesFromJson(raw: unknown): GraphNodeRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (isRecord(raw) && Array.isArray(raw.nodes)) return raw.nodes.filter(isRecord);
  if (!isRecord(raw)) return [];
  return Object.entries(raw).map(([name, value]) => {
    if (isRecord(value)) return { ...value, name: value.name ?? name };
    return { name };
  });
}

export function graphPackagePaths(nodes: readonly GraphNodeRecord[]): string[] {
  const packages = new Set<string>();
  for (const node of nodes) {
    const packagePath = packagePathFromLabel(graphNodeNameOf(node));
    if (packagePath) packages.add(packagePath);
  }
  return [...packages].sort();
}

export function computeSelectedCppPackageClosure(
  nodes: readonly GraphNodeRecord[],
  target: string,
): string[] {
  const want = normalizeTargetLabel(target);
  if (!want) return [];
  const packages = new Set<string>();
  for (const node of selectedGraphNodes(nodes, want)) {
    const pkg = packagePathFromLabel(graphNodeNameOf(node));
    if (pkg) packages.add(pkg);
  }
  return [...packages].sort();
}
