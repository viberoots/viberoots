#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";
import { FILTERED_FLAKE_RSYNC_EXCLUDES } from "../../dev/nix-build-filtered-flake-lib";
import { REQUIRED_FILTERED_FLAKE_EXCLUDES } from "./filtered-flake-snapshot-required-excludes";

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
  const buildMain = await readTool("tools/dev/nix-build-filtered-flake.ts");
  const buildHelper = [
    buildMain,
    await readTool("tools/dev/nix-build-filtered-flake-preparation.ts"),
    await readTool("tools/dev/nix-build-filtered-flake-declared-inputs.ts"),
    await readTool("tools/dev/nix-build-filtered-flake-runtime.ts"),
  ].join("\n");
  const helper = [buildHelper, await readTool("tools/dev/filtered-flake-viberoots-input.ts")].join(
    "\n",
  );
  for (const token of REQUIRED_FILTERED_FLAKE_EXCLUDES) {
    if (!FILTERED_FLAKE_RSYNC_EXCLUDES.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }
  if (FILTERED_FLAKE_RSYNC_EXCLUDES.includes("pnpm-workspace.yaml")) {
    throw new Error(
      "filtered flake snapshots must preserve pnpm-workspace.yaml because it can affect frozen lockfile validation",
    );
  }
  assert.ok(FILTERED_FLAKE_RSYNC_EXCLUDES.includes("build/"));
  assert.ok(
    !FILTERED_FLAKE_RSYNC_EXCLUDES.includes("build"),
    "build output directories must be excluded without dropping the public bin/build command",
  );

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

  if (!helper.includes('"build"') || helper.includes('"--impure"')) {
    throw new Error("nix-build-filtered-flake must evaluate registered bundles without --impure");
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
    const usesSelectedGraphRoots =
      name !== "update-pnpm-hash filtered snapshot" &&
      source.includes("filteredSnapshotSelection") &&
      source.includes("snapshotSelection.relPaths");
    if (
      (!source.includes("defaultFilteredFlakeSnapshotRelPaths") && !usesSelectedGraphRoots) ||
      !source.includes("defaultFilteredFlakeSnapshotRsyncSources") ||
      !source.includes("--relative")
    ) {
      throw new Error(`${name} must use the shared allowlisted filtered-flake snapshot roots`);
    }
    if (source.includes("${src}/ ${snapDirReal}/") || source.includes("${root}/ ${snapDir}/")) {
      throw new Error(`${name} must not broad-rsync the workspace root into filtered snapshots`);
    }
  }
  assert.match(buildMain, /repairSnapshotViberootsInput/);
  assert.match(buildMain, /materializeEvaluationBundle/);
  assert.match(buildMain, /withoutEvaluationSelectors\(process\.env\)/);
  assert.doesNotMatch(buildMain, /WORKSPACE_ROOT: bundleRoot/);
  assert.ok(
    buildMain.indexOf("repairSnapshotViberootsInput({") <
      buildMain.indexOf("const bundle = await materializeEvaluationBundle") &&
      buildMain.indexOf("const bundle = await materializeEvaluationBundle") <
        buildMain.indexOf("prewarmFinalStoreForTarget("),
    "selected snapshots must repair inputs and register the bundle before pnpm-store evaluation",
  );
  assert.ok(
    buildMain.indexOf("const nixEnv = buildArtifactEnvironment") <
      buildMain.indexOf("prewarmFinalStoreForTarget("),
    "selected snapshots must establish their evaluation environment before pnpm-store prewarming",
  );
  assert.match(buildMain, /VBR_PNPM_FILTERED_SNAPSHOT_ROOT: bundleRoot/);
  assert.match(buildHelper, /attrPath: pnpmStoreAttrFromImporter\(importer\),\s+env,/);
  assert.doesNotMatch(buildMain, /tempRepoLiveViberootsRoot|activeViberootsRoot/);
  if (
    !helper.includes("copyWorkspaceGraphIntoSnapshot") ||
    !helper.includes('path.join(snapDir, ".viberoots", "buck", "graph.json")') ||
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
    !helper.includes("const flakeRef = bundle.flakeRef")
  ) {
    throw new Error(
      "nix-build-filtered-flake must build from the registered bundle flake reference",
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
  if (
    !helper.includes("resolveSnapshotFlakeDir") ||
    !helper.includes('path.join(snapDir, ".viberoots", "workspace", "flake.nix")') ||
    !helper.includes('path.join(snapDir, "flake.nix")') ||
    !helper.includes("snapshot is missing .viberoots/workspace/flake.nix and flake.nix")
  ) {
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
  for (const [name, source, environmentAuthority] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper, "buildCanonicalArtifactEnvironment"],
    ["selected-build filtered snapshot", selectedHelper, "const artifactEnv = opts.env"],
    ["nix-build-filtered-flake snapshot", helper, "envWithResolvedNixBin"],
  ] as const) {
    if (
      source.includes("process.env.NIX_BIN") ||
      source.includes('resolveToolPathSync("nix")') ||
      !source.includes(environmentAuthority) ||
      !source.includes('ensureNixStoreToolPathSync("nix"')
    ) {
      throw new Error(`${name} must invoke nix through the selected VBR_NIX_BIN environment`);
    }
  }
  if (!helper.includes('ensureNixStoreToolPathSync("nix", nixEnv)')) {
    throw new Error(
      "nix-build-filtered-flake must require the nix command from the same env passed to nix",
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
