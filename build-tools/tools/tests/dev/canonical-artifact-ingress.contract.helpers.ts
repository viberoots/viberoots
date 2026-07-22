import assert from "node:assert/strict";
import fs from "node:fs";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(rel), "utf8");
}

export function assertCanonicalArtifactIngressWiring(): void {
  for (const file of [
    "build-tools/tools/ci/artifact-command.ts",
    "build-tools/tools/dev/artifact-policy-inspection.ts",
    "build-tools/tools/tests/nix/hermetic-artifact-sandbox.integration.test.ts",
  ]) {
    const source = read(file);
    assert.match(source, /runBoundedArtifactCommand/);
    assert.doesNotMatch(source, /\bspawn(?:Sync)?\s*\(|\bexecFile(?:Sync)?\s*\(/);
  }
  const directExecutors = [
    "build-tools/tools/ci/artifact-command.ts",
    "build-tools/tools/dev/build-selected.ts",
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
    "build-tools/tools/dev/run-runnable-nix.ts",
    "build-tools/tools/dev/dev-build/buck.ts",
  ];
  for (const file of directExecutors) assert.match(read(file), /buildArtifactEnvironment/);
  for (const file of [
    "build-tools/tools/dev/build-selected-nix-command.ts",
    "build-tools/tools/dev/nix-build-filtered-flake.ts",
    "build-tools/tools/dev/run-runnable-nix.ts",
  ]) {
    assert.match(read(file), /artifactNixPolicyArgs/);
  }
  const wasm = read("build-tools/wasm/defs.bzl");
  assert.match(wasm, /nix_action_build_selected_out_path_cmd/);
  assert.match(wasm, /nix_artifact_action_inputs\(ctx\)/);
  assert.match(wasm, /run_nix_action/);
  assert.doesNotMatch(wasm, /buildArtifactEnvironment|nix-build-filtered-flake|zx-wrapper/);
  const shell = read("build-tools/lang/nix_shell.bzl");
  const declaredInputs =
    shell.match(/def nix_declared_action_inputs_manifest_cmd\(\):[\s\S]*?(?=\ndef )/)?.[0] || "";
  assert.match(declaredInputs, /\$\{SRCS:-\}/);
  assert.match(declaredInputs, /\$@/);
  assert.doesNotMatch(declaredInputs, /\$\(/);
  assert.match(shell, /nix_artifact_tool_authority_shell/);
  assert.match(shell, /--option sandbox-fallback false/);
  assert.doesNotMatch(shell, /nix_cache_health_shell/);
  assert.match(shell, /NIX_ARTIFACT_TOOLS_ROOT/);
  assert.match(shell, /NIX_ARTIFACT_SUBSTITUTERS/);
  assert.match(shell, /NIX_ARTIFACT_TRUSTED_PUBLIC_KEYS/);
  assert.match(shell, /--option substituters/);
  assert.match(shell, /--option trusted-public-keys/);
  assert.match(shell, /VBR_ARTIFACT_TOOLS_ROOT/);
  assert.match(
    shell,
    /if \[ -x \/nix\/var\/nix\/profiles\/default\/bin\/nix \]; then NIX_BIN=\/nix\/var\/nix\/profiles\/default\/bin\/nix; else NIX_BIN=/,
  );
  assert.doesNotMatch(shell, /NIX_BIN=\"\$\{VBR_NIX_BIN/);
  const filtered = read("build-tools/tools/dev/filtered-flake.ts");
  assert.match(filtered, /readDirtyGitStats\(src, artifactEnv\)/);
  assert.match(filtered, /readSnapshotStats\(snapDirReal, artifactEnv\)/);
  assert.match(filtered, /repairSnapshotViberootsInput\(\{[\s\S]*?env: artifactEnv/);
  assert.match(filtered, /materializeEvaluationBundle\(\{[\s\S]*?artifactEnv/);
  const bundleRegister = read("build-tools/tools/dev/evaluation-bundle-register.ts");
  assert.match(bundleRegister, /ensureNixStoreToolPathSync\("nix", env\)/);
  assert.doesNotMatch(bundleRegister, /resolveToolPathSync|process\.env/);
  const bundleOwner = read("build-tools/tools/dev/evaluation-bundle-owner.ts");
  assert.match(bundleOwner, /ensureNixStoreToolPathSync\("bash", artifactEnv\)/);
  assert.doesNotMatch(bundleOwner, /resolveWatchdogShell\(process\.env\)/);
  assert.match(shell, /unset [^;]*NODE_OPTIONS/);
  const bootstrap = shell.match(/def nix_bootstrap_env_core\(\):[\s\S]*?(?=\ndef )/)?.[0] || "";
  assert.ok(
    bootstrap.lastIndexOf("nix_artifact_environment_shell()") >
      bootstrap.lastIndexOf("workspace-root.env"),
    "artifact environment authority must be applied after workspace metadata",
  );
  const publisher = read("build-tools/tools/ci/publish-nix-cache-manifest.ts");
  assert.match(
    publisher,
    /if \(backend === "attic" \|\| backend === "cachix"\)[\s\S]*runDeclaredArtifactPublisher\([\s\S]*?\}\);[\s\S]*else \{[\s\S]*runArtifactNix\(/,
  );
  assert.match(publisher, /runDeclaredArtifactPublisher/);
  assert.doesNotMatch(publisher, /runArtifactTool|chooseRunnableFlakeRef/);
  assert.doesNotMatch(publisher, /--impure|\$`nix\b|\$`bash\b/);
  assert.match(publisher, /reproducibilityAggregate/);
  assert.doesNotMatch(publisher, /readSourceRevision|readFile\(["']flake\.lock/);
  const wheelhouse = read("build-tools/tools/ci/wheelhouse-preload.ts");
  assert.match(wheelhouse, /runArtifactNix/);
  assert.match(wheelhouse, /chooseRunnableFlakeRef/);
  assert.match(wheelhouse, /readSignedReproducibilityAggregate/);
  assert.match(wheelhouse, /stageSystemReproducibilityOutputs/);
  assert.doesNotMatch(wheelhouse, /runArtifactTool|--impure|\$`nix\b|\$`bash\b/);
  assert.doesNotMatch(wheelhouse, /readSourceRevision|readFile\(["']flake\.lock/);
  for (const file of [
    "build-tools/node/defs_core.bzl",
    "build-tools/node/defs_nix.bzl",
    "build-tools/node/defs_stage.bzl",
    "build-tools/go/private/nix_build_wasm.bzl",
  ]) {
    const source = read(file);
    assert.match(source, /nix_action_build_selected_out_path_cmd/);
    assert.doesNotMatch(source, /--impure|path:\$FLK_ROOT|nix_build_out_path_cmd/);
  }
  const actionInputs = read("build-tools/lang/nix_artifact_inputs.bzl");
  for (const required of [
    "_build_selected",
    "_export_graph",
    "_graph_json",
    "_nix_build_filtered_flake",
    "_workspace_root_env",
    "_zx_init",
  ]) {
    assert.match(actionInputs, new RegExp(required));
  }
  for (const file of [
    "build-tools/go/private/nix_build.bzl",
    "build-tools/go/private/nix_build_carchive.bzl",
    "build-tools/go/private/nix_build_wasm.bzl",
    "build-tools/python/private/nix_build.bzl",
    "build-tools/cpp/private/nix_build.bzl",
    "build-tools/rust/private/nix_build.bzl",
  ]) {
    const source = read(file);
    assert.match(source, /nix_artifact_action_inputs\(ctx\)/);
    assert.match(source, /with_nix_artifact_action_attrs/);
  }
  assert.match(read("build-tools/node/defs_core.bzl"), /nix_artifact_tool_source_labels\(\)/);
  for (const file of [
    "build-tools/go/private/nix_build.bzl",
    "build-tools/go/private/nix_build_carchive.bzl",
    "build-tools/go/private/nix_build_wasm.bzl",
    "build-tools/go/private/nix_test.bzl",
    "build-tools/python/private/nix_build.bzl",
    "build-tools/python/private/nix_test.bzl",
    "build-tools/cpp/private/nix_build.bzl",
    "build-tools/cpp/private/nix_test.bzl",
    "build-tools/rust/private/nix_build.bzl",
    "build-tools/node/private/nix_test.bzl",
  ]) {
    assert.match(read(file), /nix_artifact_bash\(\)/);
  }
  for (const file of [
    "build-tools/tools/nix/flake/packages/node-webapp.nix",
    "build-tools/tools/nix/flake/packages/node-service.nix",
    "build-tools/tools/nix/planner/node-webapp.nix",
    "build-tools/tools/nix/planner/node-app.nix",
  ]) {
    const source = read(file);
    for (const variable of source.matchAll(/([A-Z]+_BIN)=.*node_modules\/\.bin\//g)) {
      assert.match(source, new RegExp(`\\$\\{pkgs\\.bash\\}/bin/bash \"\\$${variable[1]}\"`));
    }
  }
}
