#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  loadVerifyTargetLabels,
  planVerifyTargetPasses,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
} from "../../dev/verify/target-passes";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const heavyTargets = [
  "viberoots//:dev_nix_gaps_parity_and_hermeticity",
  "viberoots//:dev_runnable_commands_selected_fast_path",
  "viberoots//:dev_update_command_launcher_integration",
  "viberoots//:node_node_wasm_inline_module_instantiate",
  "viberoots//:rust_rust_extensions_remote_cache_materialization",
  "viberoots//:rust_rust_node_consumers_stage_native_addon",
  "viberoots//:rust_rust_source_selection_identity_parity",
  "viberoots//:rust_rust_tauri_dependency_patch_identity",
  "viberoots//:rust_rust_tauri_input_invalidation_behavior",
  "viberoots//:rust_rust_wasm_wasi_artifacts",
  "viberoots//:scaffolding_webapp_ssr_vite_runnable_contracts",
  "viberoots//:scaffolding_webapp_wasm_runtime_authority_contract",
].sort();
const ordinaryTarget = "viberoots//:verify_verify_progress_line";
const localPolicy = parseVerifyExecutionPolicy({ env: {} });

async function auditProviders(target: string, iso: string): Promise<string> {
  const result =
    await $`buck2 --isolation-dir ${iso} audit providers --target-platforms prelude//platforms:default ${target}`
      .nothrow()
      .quiet();
  assert.equal(result.exitCode, 0, String(result.stderr || ""));
  return String(result.stdout || "");
}

test("heavy-fanout setup exposes one static permit without a broker lifecycle", () => {
  const setup = fs.readFileSync(
    viberootsSourcePath("build-tools/tools/buck/heavy-fanout-resource.py"),
    "utf8",
  );
  assert.match(setup, /"resources": \[\{"permit": "viberoots-heavy-fanout"\}\]/);
  assert.doesNotMatch(setup, /\b(pid|kill|cleanup|terminate|subprocess)\b/i);
  const rule = fs.readFileSync(viberootsSourcePath("build-tools/tools/buck/zx_test.bzl"), "utf8");
  assert.match(
    rule,
    /local_resources\["viberoots_heavy_fanout"\] = ctx\.attrs\.heavy_fanout_pool\.label/,
  );
  assert.match(
    rule,
    /RequiredTestLocalResource\(\s*"viberoots_heavy_fanout",\s*listing = False,\s*execution = True,/,
  );
  assert.match(rule, /script_repo_path = package_prefix \+ script_repo_path/);
  assert.match(rule, /CAND3=\\"\$VBR_ROOT\/%s\\"/);
});

test("heavy-fanout taxonomy binds exactly twelve resource-limited tests to one pool", () => {
  const labels = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("heavy-fanout-labels"),
    targets: [...heavyTargets, ordinaryTarget],
    executionPolicy: localPolicy,
  });
  const marked = labels
    .filter((entry) => entry.labels.includes("verify:heavy-fanout"))
    .map((entry) => entry.target)
    .sort();
  assert.deepEqual(marked, heavyTargets);
  for (const target of heavyTargets) {
    const entry = labels.find((candidate) => candidate.target === target);
    assert.ok(entry?.labels.includes("verify:resource-limited"), target);
  }

  const broadOrdinary = Array.from({ length: 50 }, (_, index) => ({
    target: `viberoots//:ordinary_${index}`,
    labels: ["verify:resource-limited"],
  }));
  const passes = planVerifyTargetPasses([...labels, ...broadOrdinary]);
  const resourcePasses = passes.filter((pass) => pass.name === "resource-limited");
  assert.equal(resourcePasses.length, 1);
  assert.equal(resourcePasses[0]?.threadsOverride, VERIFY_BROAD_RESOURCE_LIMITED_THREADS);
  for (const target of heavyTargets) assert.ok(resourcePasses[0]?.targets.includes(target), target);
  assert.equal(
    passes.find((pass) => pass.name === "isolated-bounded")?.targets.includes(heavyTargets[6]!) ??
      false,
    false,
  );
});

test("heavy-fanout providers expose the shared required local resource", async () => {
  const iso = inheritedBuckIsolation("heavy-fanout-providers");
  for (const target of heavyTargets) {
    const provider = await auditProviders(target, iso);
    assert.match(provider, /ExternalRunnerTestInfo\(/, target);
    assert.match(provider, /builder_policy="local_only"/, target);
  }
  const ordinary = await auditProviders(ordinaryTarget, iso);
  assert.match(ordinary, /ExternalRunnerTestInfo\(/);

  const pool = await auditProviders("viberoots//:viberoots_heavy_fanout", iso);
  assert.match(pool, /LocalResourceInfo\(/);
  assert.match(pool, /resource_env_vars=\{\s*"VBR_HEAVY_FANOUT_PERMIT": "permit"\s*\}/);
  assert.match(pool, /heavy-fanout-resource\.py/);
});
