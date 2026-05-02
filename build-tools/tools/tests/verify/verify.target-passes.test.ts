#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planVerifyTargetPasses,
  VERIFY_ISOLATED_LABEL,
  VERIFY_RESOURCE_LIMITED_LABEL,
  VERIFY_RESOURCE_LIMITED_THREADS,
} from "../../dev/verify/target-passes.ts";
import {
  groupVerifyPassesForExecution,
  resourceLimitedStartDelaySeconds,
  verifyPassIsolationDir,
} from "../../dev/verify/verify-pass-scheduling.ts";

test("verify target passes batch isolated targets ahead of the shared batch", () => {
  const passes = planVerifyTargetPasses([
    { target: "//projects/apps/pleomino:pr14_latency", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//projects/apps/pleomino:unit", labels: ["kind:test"] },
    {
      target: "//:deployments_nixos_shared_host_reuse_e2e",
      labels: ["kind:test", VERIFY_RESOURCE_LIMITED_LABEL],
    },
    {
      target: "//:scaffolding_webapp_ssr_next_contracts",
      labels: ["kind:test", VERIFY_ISOLATED_LABEL],
    },
  ]);

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: [
        "//projects/apps/pleomino:pr14_latency",
        "//:scaffolding_webapp_ssr_next_contracts",
      ],
      threadsOverride: 1,
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
      labels: [VERIFY_ISOLATED_LABEL, VERIFY_RESOURCE_LIMITED_LABEL],
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
      { target: "//projects/apps/pleomino:pr14_latency", labels: [VERIFY_ISOLATED_LABEL] },
      {
        target: "//:scaffolding_webapp_ssr_next_contracts",
        labels: ["kind:test", VERIFY_ISOLATED_LABEL],
      },
    ],
    { isolatedMode: "per-target" },
  );

  assert.deepEqual(passes, [
    {
      name: "isolated://projects/apps/pleomino:pr14_latency",
      targets: ["//projects/apps/pleomino:pr14_latency"],
      threadsOverride: 1,
    },
    {
      name: "isolated://:scaffolding_webapp_ssr_next_contracts",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: 1,
    },
  ]);
});

test("verify target pass execution keeps isolated serial but overlaps bounded and shared work", () => {
  const passes = planVerifyTargetPasses([
    { target: "//:startup_sensitive", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//:resource_heavy", labels: [VERIFY_RESOURCE_LIMITED_LABEL] },
    { target: "//:ordinary", labels: ["kind:test"] },
  ]);

  assert.deepEqual(
    groupVerifyPassesForExecution(passes).map((group) => group.map((pass) => pass.name)),
    [["isolated"], ["resource-limited", "shared"]],
  );
});

test("resource-limited pass start delay only applies to broad shared runs", () => {
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
      BNX_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS: "0",
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
