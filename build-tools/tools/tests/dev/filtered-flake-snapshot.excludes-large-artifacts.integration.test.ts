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
    ".viberoots/cache",
    ".viberoots/workspace/.viberoots",
    "viberoots/.viberoots",
    ".clinic",
    ".turbo",
    ".cache",
    "pnpm-workspace.yaml",
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

  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (!source.includes("filteredFlakeRsyncExcludeArgs")) {
      throw new Error(`${name} must use the shared filtered-flake rsync excludes`);
    }
    if (
      !source.includes("tempRepoLiveViberootsRoot") ||
      !source.includes("VBR_RUN_IN_TEMP_REPO") ||
      !source.includes("VIBEROOTS_SOURCE_ROOT")
    ) {
      throw new Error(
        `${name} must reuse the stable live viberoots input for temp-repo filtered flakes`,
      );
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
      !source.includes('"narHash"') ||
      !source.includes('"lastModified"') ||
      !source.includes("flake metadata --json")
    ) {
      throw new Error(`${name} must write hash-bearing path locks for local-file verification`);
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
