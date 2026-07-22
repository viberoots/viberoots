#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { assertCanonicalArtifactIngressWiring } from "./canonical-artifact-ingress.contract.helpers";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(rel), "utf8");
}

test("all artifact executors use canonical environment and Nix policy authorities", () => {
  assertCanonicalArtifactIngressWiring();
});

test("Node genlike builds remain inside the strict Nix sandbox", () => {
  const planner = read("build-tools/tools/nix/planner/node-genlike.nix");
  const helpers = read("build-tools/tools/nix/lib/lang-helpers.nix");
  const pnpm = read("build-tools/tools/nix/pnpm-11.nix");
  assert.doesNotMatch(planner, /sandboxProfile|darwinBashrcSandboxProfileAttrs/);
  assert.doesNotMatch(helpers, /sandboxProfile|darwinBashrcSandboxProfileAttrs|\/etc\/bashrc/);
  assert.match(pnpm, /#!\$\{pkgs\.nodejs_22\}\/bin\/node/);
  assert.match(pnpm, /package\/bin\/pnpm\.mjs/);
});

test("Node planner keeps stamped control inputs out of artifact dependency resolution", () => {
  const planner = read("build-tools/tools/nix/planner/node-genlike.nix");
  assert.match(planner, /stampedControlInputs = map H\.normalizeTargetLabel/);
  assert.match(
    planner,
    /!\(builtins\.elem \(H\.normalizeTargetLabel source\) stampedControlInputs\)/,
  );
  assert.match(planner, /artifact = dependencyArtifactOf source/);
});

test("selected-build fixtures remove inherited artifact influence before explicit inputs", () => {
  const helper = read("build-tools/tools/tests/lib/test-helpers/selected-build.ts");
  assert.match(helper, /withoutArtifactEnvironmentInfluence\(process\.env\)/);
  assert.ok(
    helper.indexOf("withoutArtifactEnvironmentInfluence(process.env)") <
      helper.indexOf("...(env || {})"),
  );
  const selectedBuildEnv =
    helper.match(
      /function selectedBuildEnv\([\s\S]*?\n}\n\nexport async function exportGraphInTemp/,
    )?.[0] || "";
  assert.doesNotMatch(selectedBuildEnv, /BUCK_TEST_SRC:/);
  assert.doesNotMatch(selectedBuildEnv, /WORKSPACE_ROOT:/);
  assert.match(helper, /--artifact-workspace-root=\$\{tmp\}/);
  assert.match(helper, /internal: \{\s*WORKSPACE_ROOT: tmp,\s*BUCK_TARGET: target,/);
  assert.match(helper, /canonicalArtifactToolsRoot\(tmp\)/);
  assert.match(helper, /const nodeBin = path\.join\([^\n]*"bin", "node"\)/);
});

test("artifact action bootstrap rejects ambient root authority", () => {
  const shell = read("build-tools/lang/nix_shell.bzl");
  const filtered = read("build-tools/tools/dev/nix-build-filtered-flake.ts");
  const clear =
    "unset FLK_ROOT REPO_ROOT VIBEROOTS_FLAKE_INPUT_ROOT VIBEROOTS_ROOT VIBEROOTS_SOURCE_ROOT WORKSPACE_ROOT ZX_INIT";
  assert.match(shell, new RegExp(clear));
  assert.ok(shell.indexOf(clear) < shell.indexOf('WS_ENV=\\"\\"'));
  assert.match(
    shell,
    /WORKSPACE_ROOT=.*WS_ENV%\/\.viberoots\/workspace\/buck\/workspace-root\.env/,
  );
  assert.match(shell, /VBR_ROOT=.*VBR_ARTIFACT_TOOLS_ROOT\/share\/viberoots-source/);
  assert.match(shell, /artifact action tool closure is missing viberoots build tools/);
  assert.doesNotMatch(shell, /VBR_ROOT=.*VIBEROOTS_ROOT:-/);
  assert.match(filtered, /artifactToolsRoot: declaredArtifactToolsRoot/);
  assert.match(filtered, /async function main\(declaredArtifactToolsRoot: string\)/);
  assert.match(filtered, /const artifactToolsRoot = enterCanonicalArtifactEntrypoint/);
  assert.match(filtered, /main\(artifactToolsRoot\)/);
  assert.doesNotMatch(filtered, /canonicalArtifactToolsRoot/);
  assert.match(filtered, /readDeclaredBuckActionInputs/);
  assert.doesNotMatch(filtered, /buck-action-root/);
  assert.match(
    filtered,
    /const inheritedNixEnv = withoutArtifactEnvironmentInfluence\(\s*envWithResolvedNixBin/,
  );
  assert.match(filtered, /const canonicalSourceRoot = path\.join/);
  assert.match(filtered, /policyEnv\.VIBEROOTS_ROOT = canonicalSourceRoot/);
  assert.doesNotMatch(filtered, /VIBEROOTS_ROOT: String\(process\.env\.VIBEROOTS_ROOT/);

  const cppRule = read("build-tools/cpp/private/nix_build.bzl");
  const emscripten = read("build-tools/tools/nix/templates/cpp-emscripten-lib.nix");
  assert.doesNotMatch(cppRule, /SECONDS|graph_export_secs|selected_build_secs|action_total_secs/);
  assert.doesNotMatch(emscripten, /SECONDS|_secs=/);
  assert.match(emscripten, /printf '%s\\t0\\n'/);
  assert.match(filtered, /copyWorkspaceControlIntoSnapshot/);
  assert.match(filtered, /prewarmFinalStoreForTarget\(\s*bundleRoot,\s*root,/);
  assert.doesNotMatch(filtered, /prewarmFinalStoreForTarget\(root, attr, flakeRef, nixEnv\)/);
  assert.doesNotMatch(filtered, /--copy-links/);
  const selected = read("build-tools/tools/dev/build-selected.ts");
  assert.match(
    selected,
    /const inheritedEnv = withoutArtifactEnvironmentInfluence\(\s*withoutEvaluationSelectors/,
  );
});

test("direct Node artifact routes declare the Buck target through explicit argv", () => {
  const shell = read("build-tools/lang/nix_shell.bzl");
  assert.doesNotMatch(shell, /nix_calling_env_export_buck_target/);
  assert.doesNotMatch(shell, /export BUCK_TARGET/);
  for (const rel of [
    "build-tools/node/defs_nix.bzl",
    "build-tools/node/defs_service.bzl",
    "build-tools/node/defs_vercel.bzl",
  ]) {
    const source = read(rel);
    assert.doesNotMatch(source, /BUCK_TARGET/);
    assert.match(source, /--target \\"\/\/%s:%s\\"/);
    assert.match(source, /native\.package_name\(\), name/);
  }
  const nodeNixTest = read("build-tools/node/private/nix_test.bzl");
  assert.doesNotMatch(nodeNixTest, /BUCK_TARGET/);
  assert.match(nodeNixTest, /--target \\"%s\\"/);
});

test("artifact worker closure includes the canonical lockfile parser", () => {
  const closure = read("build-tools/tools/nix/flake/packages/remote-worker-tools.nix");
  assert.match(closure, /workerPaths = \[[\s\S]*pkgs\.yq[\s\S]*\];/);
});

test("command-site inventory separates canonical builds from live development launchers", () => {
  const policy = JSON.parse(read("docs/handbook/nix-command-site-policy.json"));
  const rules = policy.classificationRules;
  const exceptions = JSON.parse(read("docs/handbook/nix-gaps-exceptions.json"));
  const liveRule = rules.find(
    (rule: { pathPattern: string; role: string }) =>
      rule.role === "live-d" && rule.pathPattern.includes("dev-with-wasm-watch"),
  );
  const canonicalDevBuildRule = rules.find(
    (rule: { pathPattern: string }) =>
      rule.pathPattern === "^build-tools/tools/dev/dev-build(?:\\.ts|/)",
  );
  assert.ok(liveRule);
  assert.match(liveRule.pathPattern, /dev-with-wasm-watch/);
  assert.match(liveRule.pathPattern, /run-runnable/);
  assert.equal(canonicalDevBuildRule?.role, "canonical-artifact");
  assert.ok(rules.indexOf(liveRule) < rules.indexOf(canonicalDevBuildRule));
  assert.equal(
    rules.some((rule: { pathPattern: string }) => rule.pathPattern === "^build-tools/"),
    false,
  );
  assert.equal("commandSiteInventory" in exceptions, false);
});
