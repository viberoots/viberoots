#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";
import { FILTERED_FLAKE_RSYNC_EXCLUDES } from "../../dev/nix-build-filtered-flake-lib";

const toolsRoot = buildToolsRoot(process.cwd());

async function readTool(rel: string): Promise<string> {
  return await fsp.readFile(path.join(toolsRoot, rel), "utf8");
}

test("filtered flake snapshot excludes large generated artifacts", async () => {
  const updaterHelper = await readTool("tools/dev/update-pnpm-hash/filtered-flake.ts");
  const selectedHelper = await readTool("tools/dev/filtered-flake.ts");
  const helper = await readTool("tools/dev/nix-build-filtered-flake.ts");
  const required = [
    "coverage",
    ".viberoots/buck",
    ".viberoots/buck/tmp",
    ".viberoots/cache",
    ".viberoots/workspace/.viberoots",
    ".viberoots/workspace/cache",
    ".viberoots/workspace/nix-xdg-cache",
    ".viberoots/workspace/xdg-cache",
    "viberoots/.viberoots",
    ".clinic",
    ".turbo",
    ".cache",
    ".node_modules.lockfile-guard.*",
    ".*.tmp",
    ".*.ts.??????",
    "result-*",
  ];

  for (const token of required) {
    if (!FILTERED_FLAKE_RSYNC_EXCLUDES.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }
  if (FILTERED_FLAKE_RSYNC_EXCLUDES.includes("pnpm-workspace.yaml")) {
    throw new Error(
      "filtered flake snapshots must preserve pnpm-workspace.yaml because it can affect frozen lockfile validation",
    );
  }

  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (!source.includes("filteredFlakeRsyncExcludeArgs")) {
      throw new Error(`${name} must use the shared filtered-flake rsync excludes`);
    }
    if (
      !source.includes("repairSnapshotViberootsInput") ||
      (!source.includes("rewriteViberootsInput") &&
        !source.includes("rewriteSnapshotViberootsInput")) ||
      !source.includes("lockPathInput")
    ) {
      throw new Error(`${name} must repair filtered snapshot viberoots inputs with locked paths`);
    }
  }

  if (!helper.includes('"build"') || !helper.includes('"--impure"')) {
    throw new Error(
      "nix-build-filtered-flake must use --impure so selected planner env reaches filtered flake builds",
    );
  }
  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (
      !source.includes("lockPathInput") ||
      !source.includes("narHash") ||
      !source.includes("flake prefetch --json") ||
      !source.includes("hash path --sri")
    ) {
      throw new Error(
        `${name} must prefetch and write hash-bearing path locks for local-file verification`,
      );
    }
    if (
      !source.includes("const originalPath = path.isAbsolute") ||
      !source.includes('node.original = { type: "path", path: originalPath }')
    ) {
      throw new Error(
        `${name} must keep relative path inputs relative in flake.lock original metadata`,
      );
    }
  }
  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (
      !source.includes("defaultFilteredFlakeSnapshotRelPaths") ||
      !source.includes("defaultFilteredFlakeSnapshotRsyncSources") ||
      !source.includes("--relative")
    ) {
      throw new Error(`${name} must use the shared allowlisted filtered-flake snapshot roots`);
    }
    if (source.includes("${src}/ ${snapDirReal}/") || source.includes("${root}/ ${snapDir}/")) {
      throw new Error(`${name} must not broad-rsync the workspace root into filtered snapshots`);
    }
  }
  if (
    !helper.includes("repairSnapshotViberootsInput") ||
    !helper.includes("WORKSPACE_ROOT: snapDir")
  ) {
    throw new Error(
      "nix-build-filtered-flake must evaluate self-contained filtered snapshots from the snapshot workspace root",
    );
  }
  if (
    !helper.includes("copyWorkspaceGraphIntoSnapshot") ||
    !helper.includes('path.join(snapDir, ".viberoots", "buck")') ||
    !helper.includes("fsp.copyFile(graphPath, snapshotGraphPath)") ||
    !helper.includes("path.join(snapDir, DEFAULT_GRAPH_PATH)") ||
    !helper.includes("workspaceBuckStat?.isSymbolicLink()")
  ) {
    throw new Error(
      "nix-build-filtered-flake must preserve the active Buck graph inside filtered snapshots",
    );
  }
  if (!helper.includes("repairSnapshotViberootsInput") || !helper.includes("viberoots\\.url")) {
    throw new Error(
      "nix-build-filtered-flake must rewrite snapshot flake inputs before Nix updates locks",
    );
  }
  if (
    !helper.includes("resolveSnapshotFlakeDir") ||
    !helper.includes('".viberoots", "workspace", "flake.nix"') ||
    !helper.includes("const flakeRef = `path:${flakeDir}#${attr}`")
  ) {
    throw new Error(
      "nix-build-filtered-flake must build from the resolved snapshot flake directory",
    );
  }
  if (!helper.includes("VIBEROOTS_SOURCE_ROOT: activeViberootsRoot")) {
    throw new Error(
      "nix-build-filtered-flake must pass the active viberoots source root into Nix evaluation",
    );
  }
  if (!helper.includes('path.join(abs, "flake.nix")')) {
    throw new Error("nix-build-filtered-flake must require active viberoots roots to be flakes");
  }
  if (!helper.includes("process.env.NIX_BIN") || !helper.includes('resolveToolPathSync("nix")')) {
    throw new Error(
      "nix-build-filtered-flake must invoke an explicit nix binary path so minimal Buck test PATHs work",
    );
  }
});
