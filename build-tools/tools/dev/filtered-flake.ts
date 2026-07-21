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
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "./nix-build-filtered-flake-lib";
import { emitTimingDetail } from "../lib/timing-detail";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../lib/macos-metadata";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { repairSnapshotViberootsInput } from "./filtered-flake-viberoots-input";
import { removeOwnedTempTree, rethrowAfterOwnedTempCleanup } from "../lib/owned-temp-cleanup";
import type { ArtifactBuildClassification } from "../lib/artifact-build-policy";
import { materializeEvaluationBundle } from "./evaluation-bundle";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { filteredSnapshotSelection } from "./filtered-flake-snapshot-selection";
import type { DevOverrideValues } from "./evaluation-bundle-selectors";

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
  classification?: ArtifactBuildClassification;
  platform?: string;
  env: NodeJS.ProcessEnv;
  selectorEnv: NodeJS.ProcessEnv;
  devOverrides?: DevOverrideValues;
  immutableViberootsInputRoot?: string;
  wasmBackend?: string;
  onlyCpp?: boolean;
  coverage?: boolean;
}): Promise<{
  flakeRef: string;
  workspaceRoot: string;
  bundlePath: string;
  bundleDigest: string;
  cleanup: () => Promise<void>;
}> {
  const artifactEnv = opts.env;
  const tmpBase = artifactEnv.TMPDIR || "/tmp";
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
      const dirty = await readDirtyGitStats(src, artifactEnv);
      if (dirty) {
        const sample =
          dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
        console.warn(`${opts.logPrefix} dirty-tree entries=${dirty.entryCount}${sample}`);
      }
    }
    const snapshotStart = Date.now();
    const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
    const snapshotSelection = await filteredSnapshotSelection(
      src,
      opts.target || "",
      opts.graphPath,
    );
    const snapshotSources = defaultFilteredFlakeSnapshotRsyncSources(
      await existingRelPaths(src, snapshotSelection.relPaths),
    );
    await runCommand({
      command: ensureNixStoreToolPathSync("rsync", artifactEnv),
      args: [
        "-a",
        "--delete",
        "--relative",
        ...rsyncExcludes,
        ...snapshotSources,
        `${snapDirReal}/`,
      ],
      cwd: src,
      env: artifactEnv,
    });
    for (const relative of snapshotSelection.declaredSources) {
      const copied = path.join(snapDirReal, relative);
      const stat = await fsp.lstat(copied).catch(() => null);
      if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) {
        throw new Error(`declared Buck source was excluded from filtered snapshot: ${relative}`);
      }
    }
    await copyWorkspaceGraphIntoSnapshot(src, snapDirReal, opts.graphPath);
    if (filteredFlakeDiagnosticsEnabled()) {
      const stats = await readSnapshotStats(snapDirReal, artifactEnv);
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
    const immutableViberoots = await repairSnapshotViberootsInput({
      snapDir: snapDirReal,
      flakeDir,
      immutableInputRoot: opts.immutableViberootsInputRoot,
      env: artifactEnv,
    });
    if (immutableViberoots) {
      await fsp.rm(path.join(snapDirReal, "viberoots"), { recursive: true, force: true });
    }
    const bundle = await materializeEvaluationBundle({
      stagedSource: snapDirReal,
      attr: opts.attr,
      target: opts.target,
      classification: opts.classification || "hermetic",
      platform: String(opts.platform || "").trim(),
      requireGraph: Boolean(String(opts.target || "").trim()),
      artifactEnv,
      // Remaining reviewed test/language selectors are captured explicitly and
      // stripped from artifactEnv. The Wasm backend is threaded separately from argv.
      selectorEnv: opts.selectorEnv,
      devOverrides: opts.devOverrides,
      wasmBackend: opts.wasmBackend,
      onlyCpp: opts.onlyCpp,
      coverage: opts.coverage,
    });
    await removeOwnedTempTree(workDir);
    return {
      ...bundle,
      bundleDigest: bundle.digest,
    };
  } catch (error) {
    await rethrowAfterOwnedTempCleanup(error, [async () => await removeOwnedTempTree(workDir)]);
  }
}

async function copyWorkspaceGraphIntoSnapshot(
  root: string,
  snapDir: string,
  explicitGraphPath?: string,
): Promise<void> {
  const graphPath = path.resolve(String(explicitGraphPath || path.join(root, DEFAULT_GRAPH_PATH)));
  try {
    await fsp.access(graphPath);
  } catch {
    return;
  }
  const snapshotGraphPath = path.join(snapDir, DEFAULT_GRAPH_PATH);
  await mkdirWithMacosMetadataExclusion(path.dirname(snapshotGraphPath));
  await fsp.copyFile(graphPath, snapshotGraphPath);
}
