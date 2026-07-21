import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { normalizeTargetLabel } from "../lib/labels";
import { targetPackageFromLabel } from "./build-selected-helpers";
import {
  computeSelectedCppPackageClosure,
  defaultFilteredFlakeSnapshotRelPaths,
  graphDeclaredRootSourcePaths,
  graphNodesFromJson,
  graphPackagePaths,
} from "./nix-build-filtered-flake-lib";
import { findWorkspacePackageRepoDirs } from "./update-pnpm-hash/importer-workspace-packages";

async function graphSourcePaths(
  root: string,
  graphPath: string,
  target: string,
): Promise<{ packagePaths: string[]; declaredSources: string[] }> {
  const raw = JSON.parse(await fsp.readFile(graphPath, "utf8"));
  const nodes = graphNodesFromJson(raw);
  const normalizedTarget = normalizeTargetLabel(target);
  if (
    normalizedTarget &&
    !nodes.some(
      (node) =>
        normalizeTargetLabel(String((node as Record<string, unknown>).name || "")) ===
        normalizedTarget,
    )
  ) {
    throw new Error(`canonical Buck graph does not contain selected target: ${normalizedTarget}`);
  }
  const declaredSources = graphDeclaredRootSourcePaths(nodes, target);
  for (const relative of declaredSources) {
    const absolute = path.resolve(root, relative);
    const fromRoot = path.relative(root, absolute);
    if (fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new Error(`declared Buck source escapes the workspace: ${relative}`);
    }
    const stat = await fsp.lstat(absolute).catch(() => null);
    if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) {
      throw new Error(`declared Buck source is unavailable or unsupported: ${relative}`);
    }
  }
  return {
    packagePaths: target
      ? computeSelectedCppPackageClosure(nodes, target)
      : graphPackagePaths(nodes),
    declaredSources,
  };
}

export async function filteredSnapshotSelection(
  root: string,
  target: string,
  explicitGraphPath?: string,
): Promise<{ relPaths: string[]; declaredSources: string[] }> {
  const relPaths = new Set(defaultFilteredFlakeSnapshotRelPaths());
  let declaredSources: string[] = [];
  const importer = targetPackageFromLabel(target);
  const normalizedImporter = path.posix.normalize(importer);
  const importerAbs = path.resolve(root, importer);
  const importerFromRoot = path.relative(root, importerAbs);
  if (
    importer &&
    importer !== "." &&
    (importer.includes("\\") ||
      normalizedImporter !== importer ||
      importerFromRoot === ".." ||
      importerFromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(importerFromRoot))
  ) {
    throw new Error(`selected target package escapes the workspace: ${importer}`);
  }
  const graphPath = path.resolve(String(explicitGraphPath || path.join(root, DEFAULT_GRAPH_PATH)));
  try {
    const graphSources = await graphSourcePaths(root, graphPath, target);
    for (const sourcePath of graphSources.packagePaths) relPaths.add(sourcePath);
    for (const sourcePath of graphSources.declaredSources) relPaths.add(sourcePath);
    declaredSources = graphSources.declaredSources;
  } catch (error) {
    const graphExists = await fsp
      .access(graphPath)
      .then(() => true)
      .catch(() => false);
    if (graphExists) throw error;
    if (target) {
      throw new Error(
        `selected artifact target requires the canonical Buck graph: target=${target} graph=${graphPath}`,
        { cause: error },
      );
    }
  }
  if (!importer || importer === ".") return { relPaths: [...relPaths], declaredSources };
  relPaths.add(importer);
  for (const lockfile of ["pnpm-lock.yaml", "uv.lock", "go.mod"]) {
    try {
      await fsp.access(path.join(root, importer, lockfile));
      if (lockfile === "pnpm-lock.yaml") relPaths.add("projects/config/node-modules.hashes.json");
      break;
    } catch {}
  }
  for (const workspacePackageDir of await findWorkspacePackageRepoDirs({
    repoRoot: root,
    importerAbs,
  })) {
    relPaths.add(workspacePackageDir);
  }
  return { relPaths: [...relPaths], declaredSources };
}
