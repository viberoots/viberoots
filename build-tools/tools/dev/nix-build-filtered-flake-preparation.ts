import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { readGlobalNixInputTargets } from "../lib/global-nix-input-targets";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function compactPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((candidate): candidate is string => candidate !== undefined);
}

export async function existingRelPaths(
  root: string,
  relPaths: readonly string[],
): Promise<string[]> {
  const present: string[] = [];
  for (const relPath of relPaths) {
    if (await pathExists(path.join(root, relPath))) present.push(relPath);
  }
  return present;
}

export async function resolveSnapshotFlakePath(snapDir: string): Promise<string> {
  const hiddenFlake = path.join(snapDir, ".viberoots", "workspace", "flake.nix");
  if (await pathExists(hiddenFlake)) return hiddenFlake;
  return path.join(snapDir, "flake.nix");
}

export async function resolveSnapshotFlakeDir(snapDir: string): Promise<string> {
  const flakePath = await resolveSnapshotFlakePath(snapDir);
  if (!(await pathExists(flakePath))) {
    throw new Error(
      `[nix-build-filtered-flake] snapshot is missing .viberoots/workspace/flake.nix and flake.nix: ${snapDir}`,
    );
  }
  return path.dirname(flakePath);
}

export async function copyWorkspaceGraphIntoSnapshot(
  root: string,
  snapDir: string,
  declaredGraphPath: string,
): Promise<string | null> {
  const graphPath = await copyFirstDeclaredInput(
    root,
    [declaredGraphPath],
    path.join(snapDir, ".viberoots", "buck", "graph.json"),
    "workspace graph",
  );
  if (!graphPath) return null;
  const snapshotGraphPath = path.join(snapDir, DEFAULT_GRAPH_PATH);
  const snapshotWorkspaceBuck = path.dirname(snapshotGraphPath);
  const workspaceBuckStat = await fsp.lstat(snapshotWorkspaceBuck).catch(() => null);
  if (!workspaceBuckStat?.isSymbolicLink()) {
    await mkdirWithMacosMetadataExclusion(snapshotWorkspaceBuck);
    await fsp.copyFile(graphPath, snapshotGraphPath);
  }
  return snapshotGraphPath;
}

export async function copyFirstDeclaredInput(
  root: string,
  candidates: string[],
  destination: string,
  description: string,
  required = true,
): Promise<string | null> {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  for (const candidate of candidates) {
    const source = path.resolve(root, candidate);
    try {
      await fsp.copyFile(source, destination);
      return destination;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!required) return null;
  throw new Error(
    `[nix-build-filtered-flake] missing declared ${description}: ${candidates.join(", ")}`,
  );
}

export async function copyWorkspaceControlIntoSnapshot(
  root: string,
  snapDir: string,
  declaredOutputNames?: Readonly<Record<string, string>>,
): Promise<void> {
  const outputNames =
    declaredOutputNames ||
    (await readGlobalNixInputTargets(root).catch(() => undefined))?.outputNames;
  for (const { relative, candidates, required } of [
    {
      relative: ".viberoots/workspace/flake.nix",
      candidates: compactPaths([
        outputNames?.["root//.viberoots/workspace:flake.nix"],
        "__global_nix_inputs__/root.viberoots-workspace-flake.nix",
      ]),
      required: true,
    },
    {
      relative: ".viberoots/workspace/flake.lock",
      candidates: compactPaths([
        outputNames?.["root//.viberoots/workspace:flake.lock"],
        "__global_nix_inputs__/root.viberoots-workspace-flake.lock",
      ]),
      required: true,
    },
    {
      relative: ".viberoots/workspace/nixpkgs-source-registry-extension.nix",
      candidates: compactPaths([
        outputNames?.["root//.viberoots/workspace:nixpkgs-source-registry-extension"],
        "__global_nix_inputs__/root.viberoots-workspace-nixpkgs-source-registry-extension",
      ]),
      required: false,
    },
    {
      relative: "projects/config/node-modules.hashes.json",
      candidates: compactPaths([
        outputNames?.["root//projects/config:node-modules.hashes.json"],
        "__global_nix_inputs__/rootprojects-config-node-modules.hashes.json",
      ]),
      required: true,
    },
  ] as const) {
    await copyFirstDeclaredInput(
      root,
      [relative, ...candidates],
      path.join(snapDir, relative),
      relative,
      required,
    );
  }
}
