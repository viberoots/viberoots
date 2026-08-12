import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const read = async (relative: string) =>
  await fs.readFile(viberootsSourcePath(`viberoots/${relative}`), "utf8");

test("Rust WASM runtime and provenance are directional multi-output artifacts", async () => {
  const [template, evidence, wasm, materialization] = await Promise.all([
    read("build-tools/tools/nix/templates/rust.nix"),
    read("build-tools/tools/nix/templates/rust-evidence-install.nix"),
    read("build-tools/tools/nix/templates/rust-wasm-postprocess.nix"),
    read("build-tools/tools/nix/templates/rust-materialization.nix"),
  ]);
  assert.match(template, /outputs = if isWasm then \[ "out" "provenance" \]/);
  assert.match(evidence, /evidenceRoot=.*provenance.*out/);
  assert.match(evidence, /wasmPostprocess\.runtimeInstall/);
  assert.match(evidence, /wasmPostprocess\.evidenceInstall/);
  assert.match(wasm, /runtimeInstall = corePostprocess/);
  assert.match(wasm, /evidenceInstall = lib\.optionalString/);
  assert.match(wasm, /\$provenance\/share\/viberoots-rust\/wasm-manifest\.json/);
  assert.doesNotMatch(wasm, /\$out\/share\/viberoots-rust\/wasm-manifest\.json/);
  assert.match(materialization, /provenancePath = "__VIBEROOTS_RUST_PROVENANCE__"/);
});

test("Buck keeps runtime default and exposes provenance only by provider and subtarget", async () => {
  const [rule, provider, selected] = await Promise.all([
    read("build-tools/rust/private/nix_build.bzl"),
    read("build-tools/rust/private/wasm_artifact.bzl"),
    read("build-tools/lang/nix_action_runner.bzl"),
  ]);
  assert.match(rule, /DefaultInfo\(default_output = out/);
  assert.match(rule, /sub_targets\["provenance"\]/);
  assert.doesNotMatch(rule, /other_outputs = [^\n]*provenance/);
  assert.match(rule, /RustWasmArtifactInfo\(runtime = out, provenance = provenance\)/);
  assert.match(provider, /derivation_output = "provenance"/);
  assert.match(provider, /rust_nix_build_provenance/);
  assert.match(selected, /--derivation-output %s/);
});

test("Node lineage takes an explicit provenance handle without copying evidence", async () => {
  const [stage, manifest] = await Promise.all([
    read("build-tools/node/defs_stage.bzl"),
    read("build-tools/tools/node/wasm-asset-manifest.ts"),
  ]);
  assert.match(stage, /selected\.provenance/);
  assert.match(stage, /PROVENANCE_HINT/);
  assert.match(manifest, /producerLineage\(resolved, provenance/);
  assert.doesNotMatch(stage, /cp -R "\$PROVENANCE_HINT"/);
});
