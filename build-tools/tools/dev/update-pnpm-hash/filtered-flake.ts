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
import {
  materializeFilteredViberootsSource,
  repairSnapshotViberootsInput,
} from "../filtered-flake-viberoots-input";
import { runCommand } from "../filtered-flake-command";
import { removeOwnedTempTree, rethrowAfterOwnedTempCleanup } from "../../lib/owned-temp-cleanup";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../lib/artifact-environment";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

export function selectedUpdateViberootsInput(opts: {
  standalone: boolean;
  gitlinkEntry: string;
  immutableInputRoot: string;
}): string {
  if (opts.standalone) return "";
  if (/^160000\s+[0-9a-f]{40}\s+\d+\tviberoots\s*$/im.test(opts.gitlinkEntry)) return "";
  const immutableInputRoot = opts.immutableInputRoot.trim();
  if (!immutableInputRoot) {
    throw new Error(
      "[update-pnpm-hash] consumer update requires an immutable viberoots flake-input authority",
    );
  }
  return immutableInputRoot;
}

async function selectedUpdateViberootsInputRoot(
  repoRoot: string,
  env: NodeJS.ProcessEnv,
  immutableInputRoot: string,
): Promise<string> {
  const standalone =
    (await fsp
      .readFile(path.join(repoRoot, "package.json"), "utf8")
      .then((text) => JSON.parse(text)?.name === "viberoots")
      .catch(() => false)) &&
    (await fsp
      .access(path.join(repoRoot, "build-tools", "tools", "dev", "viberoots.ts"))
      .then(() => true)
      .catch(() => false));
  const gitlink = await runCommand({
    command: ensureNixStoreToolPathSync("git", env),
    args: ["ls-files", "-s", "--", "viberoots"],
    cwd: repoRoot,
    env,
    allowFailure: true,
  });
  return selectedUpdateViberootsInput({
    standalone,
    gitlinkEntry: gitlink.exitCode === 0 ? gitlink.stdout : "",
    immutableInputRoot,
  });
}

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
}): Promise<{
  flakeRef: string;
  workspaceRoot: string;
  viberootsInputRoot: string;
  cleanup: () => Promise<void>;
}> {
  const declaredViberootsInputRoot = String(process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
  // `u` is the update boundary, not a canonical envelope. Resolve authority
  // via the scoped workspace manifest (or an explicit ambient declaration when
  // the caller has one) rather than requiring canonical envelope invariants.
  const artifactEnv = buildCanonicalArtifactEnvironment(opts.repoRoot, {
    artifactToolsRoot: canonicalArtifactToolsRoot(
      opts.repoRoot,
      String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
    ),
  });
  const tmpBase = artifactEnv.TMPDIR || "/tmp";
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
    const immutableViberootsInputRoot = await selectedUpdateViberootsInputRoot(
      src,
      artifactEnv,
      declaredViberootsInputRoot,
    );
    if (filteredFlakeDiagnosticsEnabled()) {
      const dirty = await readDirtyGitStats(src, artifactEnv);
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
    if (filteredFlakeDiagnosticsEnabled()) {
      const stats = await readSnapshotStats(snapDirReal, artifactEnv);
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
    let viberootsInputRoot = await repairSnapshotViberootsInput({
      snapDir: snapDirReal,
      flakeDir,
      immutableInputRoot: immutableViberootsInputRoot,
      env: artifactEnv,
    });
    if (
      !viberootsInputRoot &&
      (await fsp
        .access(path.join(src, "build-tools", "tools", "dev", "zx-init.mjs"))
        .then(() => true)
        .catch(() => false))
    ) {
      viberootsInputRoot = (await materializeFilteredViberootsSource(snapDirReal, artifactEnv))
        .storePath;
    }
    return {
      flakeRef: `path:${flakeDir}#${opts.attr}`,
      workspaceRoot: snapDirReal,
      viberootsInputRoot,
      cleanup: async () => await removeOwnedTempTree(workDir),
    };
  } catch (error) {
    await rethrowAfterOwnedTempCleanup(error, [async () => await removeOwnedTempTree(workDir)]);
  }
}
