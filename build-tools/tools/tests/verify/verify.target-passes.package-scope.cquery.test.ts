#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadVerifyTargetLabels,
  planVerifyTargetPasses,
  summarizeVerifyTargetPlan,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  VERIFY_ISOLATED_LABEL,
  VERIFY_MANUAL_LABEL,
  VERIFY_RESOURCE_LIMITED_LABEL,
} from "../../dev/verify/target-passes";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const localExecutionPolicy = parseVerifyExecutionPolicy({ env: {} });

test("verify target pass loading expands package scopes before isolating labeled targets", () => {
  const targets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-package-scope"),
    targets: ["//projects/apps/pleomino/..."],
    executionPolicy: localExecutionPolicy,
  });

  assert.deepEqual(
    targets.map((entry) => entry.target),
    [
      "//projects/apps/pleomino:hash-regression",
      "//projects/apps/pleomino:latency-guardrail",
      "//projects/apps/pleomino:offline-acceptance",
      "//projects/apps/pleomino:seeded-solver",
      "//projects/apps/pleomino:static-pwa-contracts",
      "//projects/apps/pleomino:unit",
    ],
  );
  assert.ok(
    targets
      .find((entry) => entry.target === "//projects/apps/pleomino:latency-guardrail")
      ?.labels.includes(VERIFY_ISOLATED_LABEL),
    "expected package-scope expansion to preserve verify:isolated labels",
  );

  const passes = planVerifyTargetPasses(targets);
  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//projects/apps/pleomino:latency-guardrail"],
      threadsOverride: 1,
    },
    {
      name: "shared",
      targets: [
        "//projects/apps/pleomino:hash-regression",
        "//projects/apps/pleomino:offline-acceptance",
        "//projects/apps/pleomino:seeded-solver",
        "//projects/apps/pleomino:static-pwa-contracts",
        "//projects/apps/pleomino:unit",
      ],
    },
  ]);
});

test("verify target pass loading keeps wildcard scope broad while isolating labeled targets", () => {
  const targets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-wildcard-scope"),
    targets: ["//..."],
    executionPolicy: localExecutionPolicy,
  });

  const targetSet = new Set(targets.map((entry) => entry.target));
  assert.ok(
    targetSet.has("//:verify_template_test_scope_policy"),
    "expected wildcard expansion to retain build-system zx tests",
  );
  assert.equal(
    [...targetSet].some((target) =>
      target.startsWith("//build-tools/tools/tests/remote-exec/wrapper-fixtures:"),
    ),
    false,
    "expected wildcard expansion to skip provider-only wrapper fixture tests",
  );
  assert.ok(
    targetSet.has("//projects/apps/pleomino:latency-guardrail"),
    "expected wildcard expansion to retain isolated project tests",
  );

  const passes = planVerifyTargetPasses(targets);
  const isolatedPass = passes.find((pass) => pass.name === "isolated");
  assert.ok(isolatedPass, "expected wildcard expansion to keep an isolated serial batch");
  assert.ok(
    isolatedPass.targets.includes("//projects/apps/pleomino:latency-guardrail"),
    "expected isolated project test to remain in the isolated batch",
  );
  assert.ok(
    isolatedPass.targets.includes("//:dev_verify_orphan_owned_process_cleanup"),
    "expected process cleanup probes to run outside concurrent verify passes",
  );
  assert.ok(
    isolatedPass.targets.includes("//:dev_verify_temp_repo_buck_cleanup_scoped"),
    "expected temp-repo cleanup probes to run outside concurrent verify passes",
  );
  assert.equal(isolatedPass.threadsOverride, 1);
  const sharedPass = passes.find((pass) => pass.name === "shared");
  assert.ok(sharedPass, "expected wildcard expansion to keep a shared verify pass");
  assert.ok(
    sharedPass?.targets.includes("//:verify_template_test_scope_policy"),
    "expected build-system zx tests to remain in the shared pass",
  );
  const resourceLimitedPass = passes.find((pass) => pass.name === "resource-limited");
  assert.ok(
    resourceLimitedPass?.targets.includes("//:deployments_nixos_shared_host_reuse_e2e"),
    "expected resource-heavy deployment tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.includes("//:scaffolding_node_cli_scaffold_lockfile_present"),
    "expected resource-heavy scaffold tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.includes("//:planner_planner_dev_overrides_go_log_present"),
    "expected resource-heavy planner tests to run outside the shared pass",
  );
  assert.ok(
    resourceLimitedPass?.targets.every((target) => !isolatedPass.targets.includes(target)),
    "expected isolated targets to stay out of the resource-limited pass",
  );
  assert.equal(resourceLimitedPass?.threadsOverride, VERIFY_BROAD_RESOURCE_LIMITED_THREADS);
  const resourceLimitedLabels = targets.find(
    (entry) => entry.target === "//:deployments_nixos_shared_host_reuse_e2e",
  )?.labels;
  assert.ok(
    resourceLimitedLabels?.includes(VERIFY_RESOURCE_LIMITED_LABEL),
    "expected resource-limited deployment target labels to survive wildcard expansion",
  );
  const summary = summarizeVerifyTargetPlan({ targetLabels: targets, passes });
  assert.equal(summary.expandedTargetCount, targets.length);
  assert.equal(summary.isolatedPassCount, 1);
  assert.ok(summary.isolatedTargetCount >= 15);
  assert.equal(summary.resourceLimitedPassCount, 1);
  assert.ok(summary.resourceLimitedTargetCount > 0);
  assert.equal(summary.sharedTargetCount, sharedPass?.targets.length ?? 0);
  assert.equal(summary.passCount, 3);
});

test("verify target pass loading keeps manual targets explicit-only", () => {
  const wildcardTargets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-manual-wildcard"),
    targets: ["//build-tools/tools/tests/remote-exec/wrapper-fixtures/..."],
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
    targets: ["//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_remote"],
    executionPolicy: localExecutionPolicy,
  });
  assert.deepEqual(
    explicitTargets.map((entry) => entry.target),
    ["//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_remote"],
  );
  assert.ok(
    explicitTargets[0]?.labels.includes(VERIFY_MANUAL_LABEL),
    "expected explicit manual fixture target labels to remain visible",
  );
});
