#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadVerifyTargetLabels,
  planVerifyTargetPasses,
  summarizeVerifyTargetPlan,
  VERIFY_ISOLATED_LABEL,
} from "../../dev/verify/target-passes.ts";
import { inheritedBuckIsolation } from "../lib/test-helpers.ts";

test("verify target pass loading expands package scopes before isolating labeled targets", () => {
  const targets = loadVerifyTargetLabels({
    root: process.cwd(),
    iso: inheritedBuckIsolation("verify-target-passes-package-scope"),
    targets: ["//projects/apps/pleomino/..."],
  });

  assert.deepEqual(
    targets.map((entry) => entry.target),
    [
      "//projects/apps/pleomino:pr10_offline_acceptance",
      "//projects/apps/pleomino:pr13_regression",
      "//projects/apps/pleomino:pr14_latency",
      "//projects/apps/pleomino:pr15_seeded",
      "//projects/apps/pleomino:pr4_static_pwa_hardening",
      "//projects/apps/pleomino:unit",
    ],
  );
  assert.ok(
    targets
      .find((entry) => entry.target === "//projects/apps/pleomino:pr14_latency")
      ?.labels.includes(VERIFY_ISOLATED_LABEL),
    "expected package-scope expansion to preserve verify:isolated labels",
  );

  const passes = planVerifyTargetPasses(targets);
  assert.deepEqual(passes, [
    {
      name: "isolated://projects/apps/pleomino:pr14_latency",
      targets: ["//projects/apps/pleomino:pr14_latency"],
      threadsOverride: 1,
    },
    {
      name: "shared",
      targets: [
        "//projects/apps/pleomino:pr10_offline_acceptance",
        "//projects/apps/pleomino:pr13_regression",
        "//projects/apps/pleomino:pr15_seeded",
        "//projects/apps/pleomino:pr4_static_pwa_hardening",
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
  });

  const targetSet = new Set(targets.map((entry) => entry.target));
  assert.ok(
    targetSet.has("//:verify_template_test_scope_policy"),
    "expected wildcard expansion to retain build-system zx tests",
  );
  assert.ok(
    targetSet.has("//projects/apps/pleomino:pr14_latency"),
    "expected wildcard expansion to retain isolated project tests",
  );

  const passes = planVerifyTargetPasses(targets);
  const isolatedPass = passes.find(
    (pass) => pass.name === "isolated://projects/apps/pleomino:pr14_latency",
  );
  assert.deepEqual(isolatedPass, {
    name: "isolated://projects/apps/pleomino:pr14_latency",
    targets: ["//projects/apps/pleomino:pr14_latency"],
    threadsOverride: 1,
  });
  const sharedPass = passes.find((pass) => pass.name === "shared");
  assert.ok(sharedPass, "expected wildcard expansion to keep a shared verify pass");
  assert.ok(
    sharedPass?.targets.includes("//:verify_template_test_scope_policy"),
    "expected build-system zx tests to remain in the shared pass",
  );
  assert.deepEqual(summarizeVerifyTargetPlan({ targetLabels: targets, passes }), {
    expandedTargetCount: targets.length,
    isolatedPassCount: 1,
    isolatedTargetCount: 1,
    sharedTargetCount: sharedPass?.targets.length ?? 0,
    passCount: 2,
  });
});
