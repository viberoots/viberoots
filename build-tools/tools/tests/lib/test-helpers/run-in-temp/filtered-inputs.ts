import * as fsp from "node:fs/promises";
import path from "node:path";
import { rethrowAfterAsyncCleanup } from "../async-cleanup";
import { pathExists } from "../../../../lib/repo";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../../../lib/macos-metadata";
import { removeTreeWithWritableFallback } from "../remove-tree";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
} from "../../../../dev/nix-build-filtered-flake-lib";
import {
  materializeFilteredViberootsSource,
  type MaterializedPathInput,
} from "../../../../dev/filtered-flake-viberoots-input";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../../../../lib/artifact-environment";

export function isGeneratedFilteredViberootsInputPath(value: string): boolean {
  const normalized = String(value || "")
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "");
  return (
    normalized === "viberoots-flake-input" ||
    normalized.startsWith("viberoots-flake-input/") ||
    normalized.endsWith("/.viberoots/workspace/viberoots-flake-input") ||
    normalized.includes("/.viberoots/workspace/viberoots-flake-input/")
  );
}
export async function workspaceFlakePath(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.nix");
  if (await pathExists(hidden)) return hidden;
  return path.join(root, "flake.nix");
}

export async function workspaceFlakeRef(root: string): Promise<string> {
  const flakePath = await workspaceFlakePath(root);
  return path.basename(flakePath) === "flake.nix" ? path.dirname(flakePath) : flakePath;
}

export async function workspaceFlakeLockPath(root: string): Promise<string> {
  const hidden = path.join(root, ".viberoots", "workspace", "flake.lock");
  if (await pathExists(hidden)) return hidden;
  return path.join(root, "flake.lock");
}

export async function candidateTempFlakePaths(root: string): Promise<string[]> {
  const candidates = [
    path.join(root, "flake.nix"),
    path.join(root, ".viberoots", "workspace", "flake.nix"),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate);
  }
  return existing;
}

export async function candidateTempFlakeLockPaths(root: string): Promise<string[]> {
  const candidates = [
    path.join(root, "flake.lock"),
    path.join(root, ".viberoots", "workspace", "flake.lock"),
  ];
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) existing.push(candidate);
  }
  return existing;
}

export async function activeViberootsRootFromWorkspace(): Promise<string> {
  const repoRoot = process.cwd();
  const moduleRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../../../../../..",
  );
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(repoRoot, "viberoots"),
    path.join(repoRoot, ".viberoots", "current"),
    moduleRoot,
    repoRoot,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (isGeneratedFilteredViberootsInputPath(root)) continue;
    const consumerViberoots = path.join(root, "viberoots");
    if (
      (await pathExists(path.join(consumerViberoots, "flake.nix"))) &&
      (await pathExists(path.join(consumerViberoots, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return consumerViberoots;
    }
    if (
      (await pathExists(path.join(root, "flake.nix"))) &&
      (await pathExists(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return root;
    }
  }
  return repoRoot;
}

export async function prepareFilteredViberootsInput(
  sourceRoot: string,
): Promise<MaterializedPathInput> {
  const workDirRaw = await mkdtempNoindex("vbr-run-in-temp-input-", {
    baseName: "vbr-run-in-temp-input",
    tmpBase: process.env.TMPDIR || "/tmp",
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const inputRoot = path.join(workDir, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (rel === ".viberoots" || rel.startsWith(".viberoots/")) continue;
      if (await pathExists(path.join(sourceRoot, rel))) relPaths.push(rel);
    }
    const sources = defaultFilteredFlakeSnapshotRsyncSources(relPaths);
    if (!sources.includes("./flake.nix")) {
      throw new Error(`runInTemp: active viberoots source is missing flake.nix: ${sourceRoot}`);
    }
    await mkdirWithMacosMetadataExclusion(inputRoot);
    await $({
      cwd: sourceRoot,
    })`rsync -a --delete --relative ${filteredFlakeRsyncExcludeArgs()} ${sources} ${inputRoot}/`;
    for (const excluded of [".viberoots", "buck-out", "node_modules"]) {
      if (await pathExists(path.join(inputRoot, excluded))) {
        throw new Error(`runInTemp: filtered viberoots input retained ${excluded}`);
      }
    }
    const env = buildCanonicalArtifactEnvironment(process.cwd(), {
      artifactToolsRoot: canonicalArtifactToolsRoot(
        process.cwd(),
        String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
      ),
    });
    return await materializeFilteredViberootsSource(inputRoot, env);
  } finally {
    await removeTreeWithWritableFallback(workDir, $);
  }
}

export async function prepareFilteredConsumerSnapshot(
  consumerRoot: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const workDirRaw = await mkdtempNoindex("vbr-run-in-temp-consumer-", {
    baseName: "vbr-run-in-temp-consumer",
    tmpBase: process.env.TMPDIR || "/tmp",
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const snapshotRoot = path.join(workDir, "source");
  try {
    const relPaths: string[] = [];
    for (const rel of defaultFilteredFlakeSnapshotRelPaths()) {
      if (await pathExists(path.join(consumerRoot, rel))) relPaths.push(rel);
    }
    const sources = defaultFilteredFlakeSnapshotRsyncSources(relPaths);
    if (!sources.includes("./flake.nix")) {
      throw new Error(`runInTemp: consumer workspace is missing flake.nix: ${consumerRoot}`);
    }
    await mkdirWithMacosMetadataExclusion(snapshotRoot);
    await $({
      cwd: consumerRoot,
    })`rsync -a --delete --relative ${filteredFlakeRsyncExcludeArgs()} ${sources} ${snapshotRoot}/`;
    for (const excluded of [
      ".viberoots/current",
      ".viberoots/workspace/prelude",
      "viberoots/prelude",
    ]) {
      if (await pathExists(path.join(snapshotRoot, excluded))) {
        throw new Error(`runInTemp: filtered consumer snapshot retained ${excluded}`);
      }
    }
    return {
      root: snapshotRoot,
      cleanup: async () => await removeTreeWithWritableFallback(workDir, $),
    };
  } catch (error) {
    await rethrowAfterAsyncCleanup(error, async () => removeTreeWithWritableFallback(workDir, $));
  }
}
