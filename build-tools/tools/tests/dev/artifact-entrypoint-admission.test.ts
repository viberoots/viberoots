#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(`build-tools/tools/${rel}`), "utf8");
}

test("b fails closed at canonical policy admission before artifact materialization", () => {
  const runner = read("dev/dev-build/run-dev-build.ts");
  const inventory = read("dev/dev-build/untracked.ts");
  assert.match(inventory, /inspectWorkspaceArtifactSource/);
  assert.doesNotMatch(inventory, /git ls-files|catch \{\}|return \{ impure: false \};\s*\}/);
  assert.match(inventory, /classification: "diagnostic-impure"/);
  assert.match(inventory, /classification: "local-development"/);
  const admission = runner.indexOf("await admitArtifactContext");
  assert.ok(admission > runner.indexOf("await runStartupCheck"));
  assert.ok(admission < runner.indexOf("await materializePureGraphIfEnabled"));
  assert.ok(admission < runner.indexOf("await runBuckCommand"));
});

test("runnable graph admission precedes snapshots and builds without a live-source fallback", () => {
  const graph = read("dev/run-runnable-graph.ts");
  const source = read("dev/run-runnable-source.ts");
  assert.match(source, /inspectWorkspaceArtifactSource/);
  assert.match(source, /purpose: opts\.purpose/);
  assert.match(
    source,
    /internal: opts\.target \? \{ BUCK_TARGET: opts\.target, WORKSPACE_ROOT: opts\.workspaceRoot \} : \{\}/,
  );
  assert.ok(
    source.indexOf("await admitArtifactContext") < source.indexOf("await makeFilteredFlakeRef"),
  );
  assert.doesNotMatch(source, /catch\s*\{\s*return \{ flakeRef:/);
  assert.doesNotMatch(source, /git ls-files --others/);
  assert.match(graph, /chooseRunnableFlakeRef/);
  assert.match(graph, /requireArtifactGraph/);
  assert.doesNotMatch(graph, /withScopedGraphEnv|await ensureGraph\(/);
  assert.match(source, /impureEvaluation: false/);
  assert.match(graph, /withoutEvaluationSelectors/);
  assert.match(
    graph,
    /withoutArtifactEnvironmentInfluence\(withoutEvaluationSelectors\(process\.env\)\)/,
  );
  assert.doesNotMatch(graph, /["']--impure["']/);
});

test("runnable, CI, and WASM routes reuse canonical graph and selected-build executors", () => {
  const authority = read("dev/artifact-graph-executor.ts");
  const ci = read("ci/run-stage.ts");
  const wasm = read("../wasm/defs.bzl");
  assert.match(authority, /artifactToolsRoot: string/);
  assert.doesNotMatch(authority, /canonicalArtifactToolsRoot/);
  assert.match(authority, /share", "viberoots-source/);
  for (const tool of ["node", "buck2", "nix"]) {
    assert.match(authority, new RegExp(`"bin", "${tool}"`));
  }
  assert.match(authority, /BUCK_QUERY_ROOTS/);
  assert.match(authority, /BUCK_TARGET_PLATFORMS: "prelude\/\/platforms:default"/);
  assert.match(ci, /requireArtifactGraph/);
  assert.match(ci, /requireArtifactGlue/);
  assert.doesNotMatch(ci, /await ensureGraph\(\)|await runGlue\(\)/);
  assert.match(wasm, /nix_action_build_selected_out_path_cmd/);
  assert.match(wasm, /nix_artifact_action_inputs\(ctx\)/);
  assert.match(wasm, /run_nix_action/);
  assert.doesNotMatch(wasm, /VIBEROOTS_ROOT|VIBEROOTS_SOURCE_ROOT|zx-wrapper|process\.env/);
});

test("every deployment runnable caller propagates a fixed protected purpose", () => {
  const deploymentRoot = viberootsSourcePath("build-tools/tools/deployments");
  const directCallers = fs
    .readdirSync(deploymentRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => read(`deployments/${entry}`).includes("buildSelectedOutPath"));
  assert.deepEqual(directCallers, ["deployment-component-artifact-dirs.ts"]);
  assert.match(read(`deployments/${directCallers[0]}`), /purpose: "deployment"/);

  const callers = fs
    .readdirSync(deploymentRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => read(`deployments/${entry}`).includes("buildDeploymentSelectedOutPath"));
  assert.deepEqual(callers.sort(), [
    "cloudflare-pages-artifact-input.ts",
    "deployment-cli-resolve.ts",
    "deployment-component-artifact-dirs.ts",
    "deployment-execution.ts",
    "nixos-shared-host-remote-cli.ts",
    "opentofu-foundation-front-door.ts",
  ]);
  for (const caller of callers) {
    const source = read(`deployments/${caller}`);
    assert.match(source, /buildDeploymentSelectedOutPath/);
  }
});

test("canonical CI artifact root does not rely on ambient job purpose", () => {
  const roots = [["ci/run-stage.ts", "ci"]] as const;
  for (const [file, purpose] of roots) {
    const source = read(file);
    assert.match(source, /inspectWorkspaceArtifactSource/);
    assert.match(source, /admitArtifactContext/);
    assert.match(source, new RegExp(`purpose: ["']${purpose}["']`));
  }
});

test("public artifact executors enter through the canonical zx wrapper", () => {
  for (const file of [
    "dev/build-selected.ts",
    "dev/dev-build.ts",
    "dev/nix-build-filtered-flake.ts",
    "ci/run-stage.ts",
    "ci/publish-nix-cache-manifest.ts",
  ]) {
    assert.equal(read(file).split("\n", 1)[0], "#!/usr/bin/env zx-wrapper", file);
  }
  assert.doesNotMatch(read("dev/artifact-policy-inspection.ts"), /artifact-policy-admission-cli/);
  assert.match(
    read("dev/artifact-policy-inspection.ts"),
    /must execute under the canonical Node closure/,
  );
  const authority = read("dev/canonical-artifact-entrypoint.ts");
  assert.match(authority, /process\.execve\(wrapper/);
  assert.match(authority, /expectedReentryEnv/);
  assert.match(authority, /isCanonicalArtifactEntrypointEnvironment\(/);
  assert.match(authority, /buckTransport\.workspaceRoot/);
  assert.doesNotMatch(authority, /process\.env\.WORKSPACE_ROOT/);
  assert.match(authority, /"share",\s*"viberoots-source",[\s\S]*?"zx-init\.mjs"/);
  assert.match(authority, /ZX_INIT: canonicalZxInit\(toolsRoot\)/);
  assert.match(authority, /--wasm-backend=/);
  assert.match(authority, /canonicalDevOverrideArg/);
  assert.match(authority, /withoutCanonicalDevOverrideArgs/);
  assert.doesNotMatch(authority, /preservedEvaluationSelectors\["WEB_WASM_BACKEND"\]/);
  const devBuild = read("dev/dev-build/run-dev-build.ts");
  const materialize = read("dev/dev-build/materialize-pure.ts");
  const buck = read("dev/dev-build/buck.ts");
  const selected = read("dev/build-selected.ts");
  const filtered = read("dev/nix-build-filtered-flake.ts");
  assert.match(devBuild, /evaluationBundleDevOverrides\(ingressArgv, \{\}\)/);
  assert.match(devBuild, /withoutCanonicalDevOverrideArgs\(ingressArgv\)/);
  assert.doesNotMatch(devBuild, /evaluationBundleHasLanguageOverrides\(process\.env\)/);
  assert.doesNotMatch(materialize, /evaluationBundleHasLanguageOverrides\(process\.env\)/);
  assert.match(buck, /viberoots\.dev_overrides is reserved for canonical ingress transport/);
  assert.match(buck, /viberoots\.dev_overrides=\$\{encodedDevOverrides\}/);
  for (const source of [selected, filtered]) {
    assert.match(source, /evaluationBundleDevOverrides\(getArgvTokens\(\), \{\}\)/);
    assert.doesNotMatch(source, /evaluationBundleHasLanguageOverrides\(process\.env\)/);
  }
  assert.match(
    authority,
    /buildCanonicalArtifactEnvironment\(scopedWorkspaceRoot, \{[\s\S]*?artifactToolsRoot: reentryTools/,
  );
  assert.match(authority, /buildCanonicalIngressEnvironment\(\{/);
  const ingress = read("dev/canonical-artifact-ingress-environment.ts");
  assert.match(ingress, /buildArtifactEnvironment\(\{/);
  assert.match(ingress, /artifactToolsRoot: opts\.toolsRoot/);
  for (const file of [
    "dev/build-selected.ts",
    "dev/dev-build.ts",
    "dev/nix-build-filtered-flake.ts",
    "ci/run-stage.ts",
    "ci/publish-nix-cache-manifest.ts",
  ]) {
    assert.match(read(file), /enterCanonicalArtifactEntrypoint/);
  }
  assert.match(
    read("dev/dev-build.ts"),
    /const artifactToolsRoot = enterCanonicalArtifactEntrypoint/,
  );
  assert.match(read("dev/dev-build.ts"), /runDevBuild\(artifactToolsRoot\)/);
  assert.match(read("dev/run-runnable-artifact.ts"), /mainWithAuthority\(artifactToolsRoot\)/);
  const ci = read("ci/run-stage.ts");
  assert.match(ci, /const artifactToolsRoot = enterCanonicalArtifactEntrypoint/);
  assert.match(ci, /artifactToolsRoot,/);
  const publication = read("ci/publish-nix-cache-manifest.ts");
  assert.match(publication, /const artifactToolsRoot = enterCanonicalArtifactEntrypoint/);
  assert.match(publication, /artifactToolsRoot,/);
  const runnable = read("dev/run-runnable.ts");
  assert.match(runnable, /initial\.mode === "prod"[\s\S]*?enterCanonicalArtifactEntrypoint/);
  assert.match(runnable, /artifactToolsRoot,/);
  assert.doesNotMatch(runnable, /parsed\.mode === "dev".*enterCanonicalArtifactEntrypoint/);
  assert.doesNotMatch(
    `${read("dev/dev-build/glue.ts")}\n${read("lib/artifact-tool-authority.ts")}`,
    /resolveCanonicalArtifactAuthority/,
  );
});

test("artifact launch wrappers sanitize devshell selectors before canonical ingress", () => {
  const sanitizer = read("bin/artifact-ingress-env.sh");
  for (const selector of [
    "CC",
    "NIX_CONFIG",
    "NODE_OPTIONS",
    "PYTHONPATH",
    "VBR_ARTIFACT_TOOLS_ROOT",
    "VIBEROOTS_ROOT",
    "WORKSPACE_ROOT",
  ]) {
    assert.match(sanitizer, new RegExp(`\\b${selector}\\b`));
  }
  for (const wrapper of [
    "bin/build",
    "bin/p",
    "ci/run-stage.sh",
    "ci/publish-nix-cache-manifest.sh",
  ]) {
    const source = read(wrapper);
    assert.match(source, /artifact-ingress-env\.sh/);
    assert.match(source, /artifact_ingress_reexec_with_devshell/);
    assert.match(source, /artifact_ingress_clear_selectors/);
    assert.match(source, /artifact_ingress_trust_devshell_baseline/);
    assert.match(source, /artifact_ingress_restore_or_remove_selectors/);
    assert.match(source, /artifact_ingress_exec/);
    assert.equal(source.includes("artifact_ingress_capture_environment"), false);
    assert.ok(
      source.indexOf("artifact_ingress_reexec_with_devshell") <
        source.indexOf("artifact_ingress_clear_selectors"),
    );
    assert.doesNotMatch(
      source,
      /VBR_RUN_IN_TEMP_REPO|\$\{ZX_INIT:-|exec node|command -v zx-wrapper/,
    );
  }
  assert.doesNotMatch(sanitizer, /\[\[ -v/);
  assert.match(sanitizer, /declare -p/);
  assert.match(sanitizer, /\.viberoots\/workspace\/toolchain-paths\.json/);
  assert.doesNotMatch(sanitizer, /command -v direnv/);
  assert.match(sanitizer, /direnv_bin="\$\{tools_root\}\/bin\/direnv"/);
  assert.match(sanitizer, /VBR_ARTIFACT_INGRESS_DIRENV_TOKEN/);
  assert.match(sanitizer, /VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED/);
  assert.match(sanitizer, /PATH="\$\{tools_root\}\/bin"/);
  assert.match(sanitizer, /exec "\$\{tools_root\}\/bin\/zx-wrapper"/);
  const jenkins = fs.readFileSync(viberootsSourcePath("Jenkinsfile"), "utf8");
  assert.match(jenkins, /run-stage\.sh/);
  assert.doesNotMatch(jenkins, /COVERAGE=1 node/);
});
