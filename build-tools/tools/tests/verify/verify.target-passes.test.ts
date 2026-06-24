#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCqueryQuery,
  normalizeVerifyTargetLabel,
  planVerifyTargetPasses,
  VERIFY_BOUNDED_ISOLATED_LABEL,
  VERIFY_BOUNDED_ISOLATED_THREADS,
  VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  VERIFY_ISOLATED_LABEL,
  VERIFY_RESOURCE_LIMITED_LABEL,
  VERIFY_RESOURCE_LIMITED_THREADS,
} from "../../dev/verify/target-passes";
import {
  groupVerifyPassesForExecution,
  resourceLimitedStartDelaySeconds,
  splitVerifyPassGroupForStagedStart,
  verifyPassIsolationDir,
} from "../../dev/verify/verify-pass-scheduling";

test("verify target cquery quotes explicit labels with operator characters", () => {
  assert.equal(
    buildCqueryQuery(["//:providers_registry_build_handlers_node+python_detected"]),
    '"//:providers_registry_build_handlers_node+python_detected"',
  );
  assert.equal(buildCqueryQuery(["//:one", "//:two+three"]), 'set("//:one" "//:two+three")');
});

test("verify target labels preserve non-root Buck cells", () => {
  assert.equal(
    normalizeVerifyTargetLabel(
      "viberoots//:dev_startup_check_extraction_blockers (root//:platform)",
    ),
    "viberoots//:dev_startup_check_extraction_blockers",
  );
  assert.equal(
    normalizeVerifyTargetLabel("root//projects/apps/service:test (root//:platform)"),
    "//projects/apps/service:test",
  );
  assert.equal(normalizeVerifyTargetLabel("//:root_test (root//:platform)"), "//:root_test");
});

test("verify target passes can batch isolated targets when explicitly requested", () => {
  const passes = planVerifyTargetPasses(
    [
      { target: "//projects/apps/pleomino:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
      { target: "//projects/apps/pleomino:unit", labels: ["kind:test"] },
      {
        target: "//:deployments_nixos_shared_host_reuse_e2e",
        labels: ["kind:test", VERIFY_RESOURCE_LIMITED_LABEL],
      },
      {
        target: "//:scaffolding_webapp_ssr_next_contracts",
        labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
      },
    ],
    { isolatedMode: "batch" },
  );

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//projects/apps/pleomino:latency-guardrail"],
      threadsOverride: 1,
    },
    {
      name: "isolated-bounded",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: VERIFY_BOUNDED_ISOLATED_THREADS,
    },
    {
      name: "resource-limited",
      targets: ["//:deployments_nixos_shared_host_reuse_e2e"],
      threadsOverride: VERIFY_RESOURCE_LIMITED_THREADS,
    },
    {
      name: "shared",
      targets: ["//projects/apps/pleomino:unit"],
    },
  ]);
});

test("verify target passes batch isolated targets by default", () => {
  const passes = planVerifyTargetPasses([
    { target: "//projects/apps/pleomino:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//projects/apps/pleomino:unit", labels: ["kind:test"] },
    {
      target: "//:deployments_nixos_shared_host_reuse_e2e",
      labels: ["kind:test", VERIFY_RESOURCE_LIMITED_LABEL],
    },
    {
      target: "//:scaffolding_webapp_ssr_next_contracts",
      labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
    },
  ]);

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//projects/apps/pleomino:latency-guardrail"],
      threadsOverride: 1,
    },
    {
      name: "isolated-bounded",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: VERIFY_BOUNDED_ISOLATED_THREADS,
    },
    {
      name: "resource-limited",
      targets: ["//:deployments_nixos_shared_host_reuse_e2e"],
      threadsOverride: VERIFY_RESOURCE_LIMITED_THREADS,
    },
    {
      name: "shared",
      targets: ["//projects/apps/pleomino:unit"],
    },
  ]);
});

test("verify target passes keep isolated labels stricter than resource-limited labels", () => {
  const passes = planVerifyTargetPasses([
    {
      target: "//:startup_sensitive",
      labels: [VERIFY_ISOLATED_LABEL, VERIFY_BOUNDED_ISOLATED_LABEL, VERIFY_RESOURCE_LIMITED_LABEL],
    },
  ]);

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//:startup_sensitive"],
      threadsOverride: 1,
    },
  ]);
});

test("verify target passes can preserve per-target isolated pass mode for debugging", () => {
  const passes = planVerifyTargetPasses(
    [
      { target: "//projects/apps/pleomino:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
      {
        target: "//:scaffolding_webapp_ssr_next_contracts",
        labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
      },
    ],
    { isolatedMode: "per-target" },
  );

  assert.deepEqual(passes, [
    {
      name: "isolated://projects/apps/pleomino:latency-guardrail",
      targets: ["//projects/apps/pleomino:latency-guardrail"],
      threadsOverride: 1,
    },
    {
      name: "isolated-bounded",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: VERIFY_BOUNDED_ISOLATED_THREADS,
    },
  ]);
});

test("verify target pass execution serializes isolated fixture-heavy lanes before shared work", () => {
  const passes = planVerifyTargetPasses([
    { target: "//:startup_sensitive", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//:fixture_heavy", labels: [VERIFY_BOUNDED_ISOLATED_LABEL] },
    { target: "//:resource_heavy", labels: [VERIFY_RESOURCE_LIMITED_LABEL] },
    { target: "//:ordinary", labels: ["kind:test"] },
  ]);

  assert.deepEqual(
    groupVerifyPassesForExecution(passes).map((group) => group.map((pass) => pass.name)),
    [["isolated"], ["isolated-bounded"], ["resource-limited", "shared"]],
  );
});

test("broad resource-limited passes lower concurrency for deployment fanout", () => {
  const passes = planVerifyTargetPasses([
    ...Array.from({ length: VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN }, (_, index) => ({
      target: `//:deployments_resource_heavy_${index}`,
      labels: [VERIFY_RESOURCE_LIMITED_LABEL],
    })),
    { target: "//:ordinary", labels: ["kind:test"] },
  ]);

  assert.equal(
    passes.find((pass) => pass.name === "resource-limited")?.threadsOverride,
    VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  );
});

test("resource-limited pass start delay only applies to broad resource-limited runs", () => {
  assert.equal(
    resourceLimitedStartDelaySeconds(
      [
        { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
        { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
      ],
      {},
    ),
    900,
  );

  assert.equal(
    resourceLimitedStartDelaySeconds(
      [
        { name: "resource-limited", targets: ["//:resource_heavy"] },
        { name: "shared", targets: ["//:ordinary"] },
      ],
      {},
    ),
    0,
  );
});

test("resource-limited pass start delay honors explicit overrides", () => {
  const passes = [
    { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
    { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
  ];

  assert.equal(
    resourceLimitedStartDelaySeconds(passes, {
      VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS: "0",
    }),
    0,
  );
  assert.equal(
    resourceLimitedStartDelaySeconds(passes, {
      VERIFY_RESOURCE_LIMITED_START_DELAY_SECS: "17",
    }),
    17,
  );
});

test("broad staged verify groups start shared before delayed resource-limited lane", () => {
  const staged = splitVerifyPassGroupForStagedStart(
    [
      { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
      { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
    ],
    {},
  );

  assert.equal(staged.delaySeconds, 900);
  assert.deepEqual(
    staged.immediatePasses.map((pass) => pass.name),
    ["shared"],
  );
  assert.deepEqual(
    staged.delayedPasses.map((pass) => pass.name),
    ["resource-limited"],
  );
});

test("concurrent verify passes use dedicated Buck isolations", () => {
  assert.equal(
    verifyPassIsolationDir({
      baseIso: "v-123-456",
      passName: "shared",
      dedicated: false,
    }),
    "v-123-456",
  );
  assert.equal(
    verifyPassIsolationDir({
      baseIso: "v-123-456",
      passName: "resource-limited",
      dedicated: true,
    }),
    "v-123-456-resource-limited",
  );
  assert.equal(
    verifyPassIsolationDir({
      baseIso: "v-123-456",
      passName: "isolated://:startup_sensitive",
      dedicated: true,
    }),
    "v-123-456-isolated-startup-sensitive",
  );
});

test("serial isolated verify passes use dedicated Buck isolations", () => {
  assert.equal(
    verifyPassIsolationDir({
      baseIso: "v-123-456",
      passName: "isolated://:startup_sensitive",
      dedicated: true,
    }),
    "v-123-456-isolated-startup-sensitive",
  );
});
