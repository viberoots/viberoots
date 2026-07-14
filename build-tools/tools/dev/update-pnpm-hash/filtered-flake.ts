import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "../filtered-flake-diagnostics";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
} from "../nix-build-filtered-flake-lib";
import { emitTimingDetail } from "../../lib/timing-detail";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../lib/macos-metadata";
import { findWorkspacePackageRepoDirs } from "./importer-workspace-packages";
import { repairSnapshotViberootsInput } from "../filtered-flake-viberoots-input";
import { runCommand } from "../filtered-flake-command";
import { removeOwnedTempTree, rethrowAfterOwnedTempCleanup } from "../../lib/owned-temp-cleanup";

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
  repoRoot: string;
  attr: string;
  importer?: string;
}): Promise<{ flakeRef: string; workspaceRoot: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDirRaw = await mkdtempNoindex("scaf-flake-", {
    baseName: "scaf-flake",
    tmpBase,
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  try {
    const snapDir = path.join(workDir, "src");
    await mkdirWithMacosMetadataExclusion(snapDir);
    const snapDirReal = await fsp.realpath(snapDir).catch(() => snapDir);
    const src = path.resolve(opts.repoRoot);
    if (filteredFlakeDiagnosticsEnabled()) {
      const dirty = await readDirtyGitStats(src);
      if (dirty) {
        const sample =
          dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
        console.warn(
          `[update-pnpm-hash] filtered flake dirty-tree entries=${dirty.entryCount}${sample}`,
        );
      }
    }
    const snapshotStart = Date.now();
    const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
    const workspacePackageDirs = opts.importer
      ? await findWorkspacePackageRepoDirs({
          repoRoot: src,
          importerAbs: path.join(src, opts.importer),
        })
      : [];
    const requestedRelPaths = opts.importer
      ? selectedNodeSnapshotRelPaths(opts.importer, workspacePackageDirs)
      : defaultFilteredFlakeSnapshotRelPaths();
    const snapshotSources = opts.importer
      ? selectedNodeSnapshotRsyncSources(await existingRelPaths(src, requestedRelPaths))
      : defaultFilteredFlakeSnapshotRsyncSources(await existingRelPaths(src, requestedRelPaths));
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
    if (filteredFlakeDiagnosticsEnabled()) {
      const stats = await readSnapshotStats(snapDirReal);
      const elapsedMs = Date.now() - snapshotStart;
      emitTimingDetail("filteredFlake updatePnpmHashSnapshotRsync", elapsedMs);
      console.warn(
        `[update-pnpm-hash] filtered flake snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
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
        "[update-pnpm-hash] filtered flake snapshot is missing .viberoots/workspace/flake.nix and flake.nix",
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
