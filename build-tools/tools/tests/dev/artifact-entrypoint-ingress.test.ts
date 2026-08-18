#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

function read(rel: string): string {
  return fs.readFileSync(viberootsSourcePath(`build-tools/tools/${rel}`), "utf8");
}

test("artifact launch wrappers sanitize devshell selectors before canonical ingress", () => {
  const sanitizer = [
    read("bin/artifact-ingress-env.sh"),
    read("bin/artifact-ingress-selectors.sh"),
    read("bin/artifact-ingress-cache.sh"),
  ].join("\n");
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
  assert.match(
    read("bin/build"),
    /artifact_ingress_publish_reviewed_nix_cache_config[\s\S]*artifact_ingress_restore_or_remove_selectors[\s\S]*artifact_ingress_clear_selectors[\s\S]*unset WORKSPACE_ROOT[\s\S]*artifact_ingress_exec/,
  );
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
