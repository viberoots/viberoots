import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./filtered-flake-command";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "./filtered-flake-diagnostics";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "./nix-build-filtered-flake-lib";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { emitTimingDetail } from "../lib/timing-detail";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../lib/macos-metadata";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { findWorkspacePackageRepoDirs } from "./update-pnpm-hash/importer-workspace-packages";
import { repairSnapshotViberootsInput } from "./filtered-flake-viberoots-input";
import { removeOwnedTempTree, rethrowAfterOwnedTempCleanup } from "../lib/owned-temp-cleanup";

async function existingRelPaths(root: string, relPaths: readonly string[]): Promise<string[]> {
  const present: string[] = [];
  for (const rel of relPaths) {
    try {
      await fsp.lstat(path.join(root, rel));
      present.push(rel);
    } catch {}
  }
  return present;
}

export async function makeFilteredFlakeRef(opts: {
  workspaceRoot: string;
  attr: string;
  logPrefix: string;
  graphPath?: string;
  target?: string;
}): Promise<{ flakeRef: string; workspaceRoot: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDirRaw = await mkdtempNoindex("vbr-flake-", {
    baseName: "vbr-flake",
    tmpBase,
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  try {
    const snapDir = path.join(workDir, "src");
    await mkdirWithMacosMetadataExclusion(snapDir);
    const snapDirReal = await fsp.realpath(snapDir).catch(() => snapDir);
    const src = path.resolve(opts.workspaceRoot);
    console.warn(
      `${opts.logPrefix} creating filtered source snapshot (excludes node_modules, buck-out, etc.)`,
    );
    if (filteredFlakeDiagnosticsEnabled()) {
      const dirty = await readDirtyGitStats(src);
      if (dirty) {
        const sample =
          dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
        console.warn(`${opts.logPrefix} dirty-tree entries=${dirty.entryCount}${sample}`);
      }
    }
    const snapshotStart = Date.now();
    const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
    const snapshotSources = defaultFilteredFlakeSnapshotRsyncSources(
      await existingRelPaths(src, await filteredSnapshotRelPaths(src, opts.target || "")),
    );
    await runCommand({
      command: "rsync",
      args: [
        "-a",
        "--delete",
        "--relative",
        ...rsyncExcludes,
        ...snapshotSources,
        `${snapDirReal}/`,
      ],
      cwd: src,
    });
    await copyWorkspaceGraphIntoSnapshot(src, snapDirReal, opts.graphPath);
    if (filteredFlakeDiagnosticsEnabled()) {
      const stats = await readSnapshotStats(snapDirReal);
      const elapsedMs = Date.now() - snapshotStart;
      emitTimingDetail("filteredFlake snapshotRsync", elapsedMs);
      console.warn(
        `${opts.logPrefix} snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
      );
    }
    const hiddenFlake = path.join(snapDirReal, ".viberoots", "workspace", "flake.nix");
    const rootFlake = path.join(snapDirReal, "flake.nix");
    const flakeDir = (await fsp
      .access(hiddenFlake)
      .then(() => true)
      .catch(() => false))
      ? path.dirname(hiddenFlake)
      : (await fsp
            .access(rootFlake)
            .then(() => true)
            .catch(() => false))
        ? snapDirReal
        : "";
    if (!flakeDir) {
      throw new Error(
        `${opts.logPrefix} filtered source snapshot is missing .viberoots/workspace/flake.nix and flake.nix`,
      );
    }
    await repairSnapshotViberootsInput({ snapDir: snapDirReal, flakeDir });
    return {
      flakeRef: `path:${flakeDir}#${opts.attr}`,
      workspaceRoot: snapDirReal,
      cleanup: async () => await removeOwnedTempTree(workDir),
    };
  } catch (error) {
    await rethrowAfterOwnedTempCleanup(error, [async () => await removeOwnedTempTree(workDir)]);
  }
}

async function filteredSnapshotRelPaths(root: string, target: string): Promise<string[]> {
  const relPaths = new Set(defaultFilteredFlakeSnapshotRelPaths());
  const importer = targetPackageFromLabel(target);
  if (!importer || importer === ".") return [...relPaths];
  const normalizedImporter = path.posix.normalize(importer);
  const importerAbs = path.resolve(root, importer);
  const importerFromRoot = path.relative(root, importerAbs);
  if (
    importer.includes("\\") ||
    normalizedImporter !== importer ||
    importerFromRoot === ".." ||
    importerFromRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(importerFromRoot)
  ) {
    throw new Error(`selected target package escapes the workspace: ${importer}`);
  }
  relPaths.add(importer);
  for (const lockfile of ["pnpm-lock.yaml", "uv.lock", "go.mod"]) {
    try {
      await fsp.access(path.join(root, importer, lockfile));
      if (lockfile === "pnpm-lock.yaml") relPaths.add("projects/node-modules.hashes.json");
      break;
    } catch {}
  }
  const workspacePackageDirs = await findWorkspacePackageRepoDirs({
    repoRoot: root,
    importerAbs,
  });
  for (const workspacePackageDir of workspacePackageDirs) {
    relPaths.add(workspacePackageDir);
  }
  return [...relPaths];
}

async function copyWorkspaceGraphIntoSnapshot(
  root: string,
  snapDir: string,
  explicitGraphPath?: string,
): Promise<void> {
  const graphPath = path.resolve(
    String(explicitGraphPath || process.env.BUCK_GRAPH_JSON || path.join(root, DEFAULT_GRAPH_PATH)),
  );
  try {
    await fsp.access(graphPath);
  } catch {
    return;
  }
  const snapshotGraphPath = path.join(snapDir, DEFAULT_GRAPH_PATH);
  await mkdirWithMacosMetadataExclusion(path.dirname(snapshotGraphPath));
  await fsp.copyFile(graphPath, snapshotGraphPath);
}
