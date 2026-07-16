#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
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
  const updaterHelper = [
    await readTool("tools/dev/update-pnpm-hash/filtered-flake.ts"),
    await readTool("tools/dev/filtered-flake-viberoots-input.ts"),
  ].join("\n");
  const selectedHelper = [
    await readTool("tools/dev/filtered-flake.ts"),
    await readTool("tools/dev/filtered-flake-viberoots-input.ts"),
  ].join("\n");
  const buildHelper = await readTool("tools/dev/nix-build-filtered-flake.ts");
  const helper = [buildHelper, await readTool("tools/dev/filtered-flake-viberoots-input.ts")].join(
    "\n",
  );
  const required = [
    "coverage",
    ".viberoots/buck",
    ".viberoots/buck/tmp",
    ".viberoots/cache",
    ".viberoots/current",
    ".codex-*.log",
    ".viberoots/workspace/.viberoots",
    ".viberoots/workspace/backups",
    ".viberoots/workspace/cache",
    ".viberoots/workspace/codex-test-logs",
    ".viberoots/workspace/exact-env-smoke.out",
    ".viberoots/workspace/host-path",
    ".viberoots/workspace/install-cache",
    ".viberoots/workspace/nix-xdg-cache",
    ".viberoots/workspace/node",
    ".viberoots/workspace/prelude",
    ".viberoots/workspace/pr-logs",
    ".viberoots/workspace/xdg-cache",
    "viberoots/.viberoots",
    "/backups",
    "/cache",
    "/codex-test-logs",
    "/install-cache",
    "/nix-xdg-cache",
    "/pr-logs",
    "/viberoots-flake-input",
    "/xdg-cache",
    ".viberoots/workspace/viberoots-flake-input",
    ".clinic",
    "viberoots/.codex-*.log",
    "viberoots/.full-test-output.log",
    "viberoots/.patch-sessions.json",
    "viberoots/backups",
    "viberoots/cache",
    "viberoots/codex-test-logs",
    "viberoots/install-cache",
    "viberoots/nix-xdg-cache",
    "viberoots/pr-logs",
    "viberoots/prelude",
    "viberoots/test-logs",
    "viberoots/xdg-cache",
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
      !source.includes("rewriteViberootsInput") ||
      !source.includes("materializeFilteredViberootsSource")
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
    const usesPrefetch =
      /flake\s+prefetch\s+--json/.test(source) ||
      /["']flake["']\s*,\s*["']prefetch["']\s*,\s*["']--json["']/.test(source);
    if (
      !source.includes("materializeFilteredViberootsSource") ||
      !source.includes("narHash") ||
      !source.includes("storePath") ||
      !usesPrefetch
    ) {
      throw new Error(
        `${name} must prefetch and write a stable immutable store path for local-file verification`,
      );
    }
    if (
      source.includes('"hash", "path", "--sri"') ||
      !source.includes("node.locked = { ...locked, path: storePath }") ||
      !source.includes('node.original = { type: "path", path: storePath }')
    ) {
      throw new Error(
        `${name} must fail closed instead of falling back from immutable store identity`,
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
    !buildHelper.includes("repairSnapshotViberootsInput") ||
    !buildHelper.includes("WORKSPACE_ROOT: snapDir")
  ) {
    throw new Error(
      "nix-build-filtered-flake must evaluate self-contained filtered snapshots from the snapshot workspace root",
    );
  }
  assert.ok(
    buildHelper.indexOf("repairSnapshotViberootsInput({ snapDir, flakeDir })") <
      buildHelper.indexOf("prewarmFinalStoreForTarget(root, attr, flakeRef, nixEnv)"),
    "selected snapshots must repair their filtered viberoots input before pnpm-store evaluation",
  );
  assert.ok(
    buildHelper.indexOf("const nixEnv = envWithResolvedNixBin") <
      buildHelper.indexOf("prewarmFinalStoreForTarget(root, attr, flakeRef, nixEnv)"),
    "selected snapshots must establish their evaluation environment before pnpm-store prewarming",
  );
  assert.match(buildHelper, /VBR_PNPM_FILTERED_SNAPSHOT_ROOT: snapDir/);
  assert.match(buildHelper, /attrPath: pnpmStoreAttrFromImporter\(importer\),\s+env,/);
  assert.doesNotMatch(buildHelper, /tempRepoLiveViberootsRoot|activeViberootsRoot/);
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
  if (
    !buildHelper.includes("VIBEROOTS_FLAKE_INPUT_ROOT: snapshotViberootsRoot") ||
    !buildHelper.includes("VIBEROOTS_ROOT: snapshotViberootsRoot") ||
    !buildHelper.includes("VIBEROOTS_SOURCE_ROOT: snapshotViberootsRoot")
  ) {
    throw new Error(
      "nix-build-filtered-flake must bind Nix evaluation to the filtered snapshot input",
    );
  }
  if (!helper.includes('path.join(snapshotRoot, "flake.nix")')) {
    throw new Error("nix-build-filtered-flake must require the filtered input to be a flake");
  }
  if (
    !helper.includes("/^\\/nix\\/store\\/[a-z0-9]{32}-source$/") ||
    helper.includes('path.join(opts.flakeDir, "viberoots-flake-input")')
  ) {
    throw new Error(
      "filtered snapshots must reference one immutable store source without embedding a nested input",
    );
  }
  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (
      source.includes("process.env.NIX_BIN") ||
      source.includes('resolveToolPathSync("nix")') ||
      !source.includes("envWithResolvedNixBin")
    ) {
      throw new Error(`${name} must invoke nix through the selected VBR_NIX_BIN environment`);
    }
  }
  if (!helper.includes('resolveToolPathSync("nix", nixEnv)')) {
    throw new Error(
      "nix-build-filtered-flake must resolve the nix command from the same env passed to nix",
    );
  }
  if (!helper.includes("resolveFinalPnpmStore")) {
    throw new Error(
      "nix-build-filtered-flake must materialize committed final pnpm stores before Nix builds",
    );
  }
  if (helper.includes("import { prepareExactPnpmStore }")) {
    throw new Error(
      "nix-build-filtered-flake must not directly prepare exact stores on selected build paths",
    );
  }
});
