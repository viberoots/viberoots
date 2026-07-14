#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  parseSelectedBuildOutPath,
  selectedNixBuildArgs,
} from "../../dev/build-selected-nix-command";
import { buildToolsRoot, buildToolPath } from "../../dev/dev-build/paths";

function sourceFile(rel: string): string {
  return buildToolPath(process.cwd(), rel);
}

function sourceRootFile(rel: string): string {
  return path.join(path.resolve(buildToolsRoot(process.cwd()), ".."), rel);
}

test("build-selected runs node patch requirement preflight", async () => {
  const file = sourceFile("tools/dev/build-selected.ts");
  const txt = await fsp.readFile(file, "utf8");
  if (!txt.includes("enforce-node-patch-requirements.ts")) {
    throw new Error(`${file} must run enforce-node-patch-requirements.ts before nix build`);
  }
  if (!txt.includes('args: ["--check"]')) {
    throw new Error(`${file} must pass --check for read-only preflight`);
  }
  if (!txt.includes("--source=auto|git|path")) {
    throw new Error(`${file} usage should document --source mode choices`);
  }
  if (!txt.includes("untrackedRequiresImpureForTargets")) {
    throw new Error(`${file} should reuse untracked impurity policy helper`);
  }
  if (!txt.includes("runMain(main)")) {
    throw new Error(`${file} must use the shared runMain entrypoint`);
  }
  if (txt.includes("import.meta.url === `file://${process.argv[1]}`")) {
    throw new Error(`${file} must not use a symlink-sensitive import.meta/process.argv guard`);
  }
  if (
    !txt.includes(
      "workspaceAbs.includes(`${path.sep}buck-out${path.sep}tmp${path.sep}tmpdir${path.sep}`)",
    )
  ) {
    throw new Error(`${file} should treat repo-local buck-out/tmp/tmpdir workspaces as temp`);
  }
  if (!txt.includes('".viberoots", "workspace"')) {
    throw new Error(`${file} should resolve hidden .viberoots/workspace flake files`);
  }
  if (txt.includes('if (!(await pathExists(path.join(workspaceRoot, "flake.nix"))))')) {
    throw new Error(`${file} must not require a visible root flake.nix`);
  }
  if (!txt.includes("resolveFinalPnpmStore")) {
    throw new Error(`${file} must materialize committed final pnpm stores before Nix builds`);
  }
  if (
    !txt.includes("const flakeEnv = flakeSource.workspaceRoot") ||
    !txt.includes("VBR_PNPM_FILTERED_SNAPSHOT_ROOT: flakeSource.workspaceRoot") ||
    (txt.match(/env: flakeEnv/g) || []).length !== 2
  ) {
    throw new Error(
      `${file} must use one marked filtered-snapshot environment for the final-store probe and build`,
    );
  }
  const flakeSourceIndex = txt.indexOf("const flakeSource = await chooseFlakeRef");
  const cleanupTryIndex = txt.indexOf("try {", flakeSourceIndex);
  const finalStoreProbeIndex = txt.indexOf("await resolveFinalPnpmStore", flakeSourceIndex);
  const cleanupFinallyIndex = txt.indexOf("finally {", finalStoreProbeIndex);
  const snapshotCleanupIndex = txt.indexOf("await flakeSource.cleanup?.()", cleanupFinallyIndex);
  if (
    flakeSourceIndex < 0 ||
    cleanupTryIndex < flakeSourceIndex ||
    finalStoreProbeIndex < cleanupTryIndex ||
    cleanupFinallyIndex < finalStoreProbeIndex ||
    snapshotCleanupIndex < cleanupFinallyIndex
  ) {
    throw new Error(`${file} must clean the filtered snapshot when the final-store probe rejects`);
  }
  if (txt.includes("import { prepareExactPnpmStore }")) {
    throw new Error(`${file} must not directly prepare exact stores on the selected build path`);
  }
});

test("build-selected constructs selected nix build argv with no-link for normal and trace modes", () => {
  assert.deepEqual(selectedNixBuildArgs({ flakeRef: "path:/repo#graph-generator-selected" }), [
    "nix",
    "build",
    "--impure",
    "--no-write-lock-file",
    "--option",
    "eval-cache",
    "false",
    "--accept-flake-config",
    "--no-link",
    "--print-out-paths",
    "path:/repo#graph-generator-selected",
  ]);
  assert.deepEqual(
    selectedNixBuildArgs({ flakeRef: "path:/repo#graph-generator-selected", showTrace: true }),
    [
      "nix",
      "build",
      "--impure",
      "--no-write-lock-file",
      "--option",
      "eval-cache",
      "false",
      "--accept-flake-config",
      "--no-link",
      "--print-out-paths",
      "--show-trace",
      "path:/repo#graph-generator-selected",
    ],
  );
});

test("build-selected consumes exactly one printed store path", () => {
  assert.equal(parseSelectedBuildOutPath("/nix/store/one-out\n"), "/nix/store/one-out");
  assert.throws(
    () => parseSelectedBuildOutPath("/nix/store/one-out\n/nix/store/two-out\n"),
    /expected exactly one selected build out path, got 2/,
  );
  assert.throws(
    () => parseSelectedBuildOutPath(""),
    /expected exactly one selected build out path/,
  );
});

test("node entrypoint macros use shared node patch preflight helper", async () => {
  const files = [
    sourceRootFile("build-tools/node/defs_core.bzl"),
    sourceRootFile("build-tools/node/defs_nix.bzl"),
    sourceRootFile("build-tools/node/defs_stage.bzl"),
  ];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (!txt.includes("nix_calling_node_patch_requirements_preflight(")) {
      throw new Error(`${file} must wire node patch preflight through shared nix helper`);
    }
  }
});
