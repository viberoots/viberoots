#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadVerifyTargetLabels,
  planVerifyTargetPasses,
  summarizeVerifyTargetPlan,
  VERIFY_BOUNDED_ISOLATED_THREADS,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  VERIFY_ENFORCEMENT_LABEL,
  VERIFY_ISOLATED_LABEL,
  VERIFY_MANUAL_LABEL,
  VERIFY_RESOURCE_LIMITED_LABEL,
} from "../../dev/verify/target-passes";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const localExecutionPolicy = parseVerifyExecutionPolicy({ env: {} });
const sampleTargets = [
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:hash-regression",
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:latency-guardrail",
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:offline-acceptance",
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:seeded-solver",
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:static-contracts",
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:unit",
];
const isolatedSampleTarget =
  "viberoots//build-tools/tools/tests/fixtures/verify-pass-scope:latency-guardrail";

test("verify target pass loading expands scopes before isolating labeled targets", async () => {
  const packageTargets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-package-scope"),
    targets: ["viberoots//build-tools/tools/tests/fixtures/verify-pass-scope/..."],
    executionPolicy: localExecutionPolicy,
  });

  assert.deepEqual(
    packageTargets.map((entry) => entry.target),
    sampleTargets,
  );
  assert.ok(
    packageTargets
      .find((entry) => entry.target === isolatedSampleTarget)
      ?.labels.includes(VERIFY_ISOLATED_LABEL),
    "expected package-scope expansion to preserve verify:isolated labels",
  );

  const packagePasses = planVerifyTargetPasses(packageTargets);
  assert.deepEqual(packagePasses, [
    {
      name: "isolated",
      targets: [isolatedSampleTarget],
      threadsOverride: 1,
    },
    {
      name: "shared",
      targets: sampleTargets.filter((target) => target !== isolatedSampleTarget),
    },
  ]);
  const wildcardTargets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-wildcard-scope"),
    targets: ["viberoots//..."],
    executionPolicy: localExecutionPolicy,
  });

  const targetSet = new Set(wildcardTargets.map((entry) => entry.target));
  assert.ok(
    targetSet.has("viberoots//:verify_template_test_scope_policy"),
    "expected wildcard expansion to retain build-system zx tests",
  );
  assert.equal(
    [...targetSet].some((target) =>
      target.startsWith("viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:"),
    ),
    false,
    "expected wildcard expansion to skip provider-only wrapper fixture tests",
  );
  assert.ok(
    targetSet.has(isolatedSampleTarget),
    "expected wildcard expansion to retain isolated fixture tests",
  );

  const passes = planVerifyTargetPasses(wildcardTargets);
  const isolatedPass = passes.find((pass) => pass.name === "isolated");
  assert.ok(isolatedPass, "expected wildcard expansion to keep an isolated serial batch");
  assert.ok(
    isolatedPass.targets.includes(isolatedSampleTarget),
    "expected isolated fixture test to remain in the isolated batch",
  );
  assert.ok(
    isolatedPass.targets.includes("viberoots//:dev_verify_orphan_owned_process_cleanup"),
    "expected process cleanup probes to run outside concurrent verify passes",
  );
  assert.ok(
    isolatedPass.targets.includes("viberoots//:dev_verify_temp_repo_buck_cleanup_scoped"),
    "expected temp-repo cleanup probes to run outside concurrent verify passes",
  );
  assert.equal(isolatedPass.threadsOverride, 1);
  const boundedIsolatedPass = passes.find((pass) => pass.name === "isolated-bounded");
  assert.ok(
    boundedIsolatedPass?.targets.includes("viberoots//:scaffolding_webapp_ssr_next_contracts"),
    "expected heavy scaffold temp-fixture tests to run in the bounded isolated pass",
  );
  assert.ok(
    boundedIsolatedPass?.targets.every((target) => !isolatedPass.targets.includes(target)),
    "expected bounded isolated tests to stay out of the strict serial pass",
  );
  assert.equal(boundedIsolatedPass?.threadsOverride, VERIFY_BOUNDED_ISOLATED_THREADS);
  const sharedPass = passes.find((pass) => pass.name === "shared");
  assert.ok(sharedPass, "expected wildcard expansion to keep a shared verify pass");
  assert.ok(
    sharedPass?.targets.includes("viberoots//:verify_template_test_scope_policy"),
    "expected build-system zx tests to remain in the shared pass",
  );
  const resourceLimitedPass = passes.find((pass) => pass.name === "resource-limited");
  assert.ok(
    resourceLimitedPass?.targets.includes("viberoots//:deployments_nixos_shared_host_reuse_e2e"),
    "expected resource-heavy deployment tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.includes(
      "viberoots//:scaffolding_node_cli_scaffold_lockfile_present",
    ),
    "expected resource-heavy scaffold tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.includes(
      "viberoots//:planner_planner_dev_overrides_go_log_present",
    ),
    "expected resource-heavy planner tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.every((target) => !isolatedPass.targets.includes(target)),
    "expected isolated targets to stay out of the resource-limited pass",
  );
  assert.equal(resourceLimitedPass?.threadsOverride, VERIFY_BROAD_RESOURCE_LIMITED_THREADS);
  const enforcementPass = passes.find((pass) => pass.name === "enforcement");
  assert.ok(enforcementPass, "expected enforcement tests to run in a dedicated light pass");
  assert.ok(
    enforcementPass.targets.includes("viberoots//:linting_process_inspection_commands_enforcement"),
    "expected enforcement convention to route *.enforcement.test.ts targets",
  );
  assert.ok(
    enforcementPass.targets.every((target) => !isolatedPass.targets.includes(target)),
    "expected enforcement targets to stay out of the serial isolated pass",
  );
  const resourceLimitedLabels = wildcardTargets.find(
    (entry) => entry.target === "viberoots//:deployments_nixos_shared_host_reuse_e2e",
  )?.labels;
  assert.ok(
    resourceLimitedLabels?.includes(VERIFY_RESOURCE_LIMITED_LABEL),
    "expected resource-limited deployment target labels to survive wildcard expansion",
  );
  const enforcementLabels = wildcardTargets.find(
    (entry) => entry.target === "viberoots//:linting_process_inspection_commands_enforcement",
  )?.labels;
  assert.ok(
    enforcementLabels?.includes(VERIFY_ENFORCEMENT_LABEL),
    "expected enforcement target labels to survive wildcard expansion",
  );
  const summary = summarizeVerifyTargetPlan({ targetLabels: wildcardTargets, passes });
  assert.equal(summary.expandedTargetCount, wildcardTargets.length);
  assert.equal(summary.isolatedPassCount, 2);
  assert.ok(summary.isolatedTargetCount >= 15);
  assert.equal(summary.resourceLimitedPassCount, 1);
  assert.ok(summary.resourceLimitedTargetCount > 0);
  assert.equal(summary.sharedTargetCount, sharedPass?.targets.length ?? 0);
  assert.equal(summary.passCount, 5);
});

test("verify target pass loading keeps manual targets explicit-only", () => {
  const wildcardTargets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-manual-wildcard"),
    targets: ["viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures/..."],
    executionPolicy: localExecutionPolicy,
  });
  assert.deepEqual(
    wildcardTargets.map((entry) => entry.target),
    [],
    "expected package-scope expansion to skip manual provider fixtures",
  );

  const explicitTargets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-manual-explicit"),
    targets: ["viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_remote"],
    executionPolicy: localExecutionPolicy,
  });
  assert.deepEqual(
    explicitTargets.map((entry) => entry.target),
    ["viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_remote"],
  );
  assert.ok(
    explicitTargets[0]?.labels.includes(VERIFY_MANUAL_LABEL),
    "expected explicit manual fixture target labels to remain visible",
  );
});
