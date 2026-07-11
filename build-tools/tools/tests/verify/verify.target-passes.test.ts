#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildCqueryQuery,
  normalizeVerifyTargetLabel,
  planVerifyTargetPasses,
  VERIFY_BOUNDED_ISOLATED_LABEL,
  VERIFY_BOUNDED_ISOLATED_THREADS,
  VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN,
  VERIFY_BROAD_RESOURCE_LIMITED_THREADS,
  VERIFY_ENFORCEMENT_LABEL,
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
import { prepareVerifyBuckIsolationMetadata } from "../../dev/verify/buck-isolation-metadata";
import { MACOS_METADATA_NEVER_INDEX_FILE } from "../../lib/macos-metadata";

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
      { target: "//projects/apps/sample-app:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
      { target: "//projects/apps/sample-app:unit", labels: ["kind:test"] },
      {
        target: "//:deployments_nixos_shared_host_reuse_e2e",
        labels: ["kind:test", VERIFY_RESOURCE_LIMITED_LABEL],
      },
      {
        target: "//:scaffolding_webapp_ssr_next_contracts",
        labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
      },
      {
        target: "//:linting_process_inspection_commands_enforcement",
        labels: ["kind:test", VERIFY_ENFORCEMENT_LABEL],
      },
    ],
    { isolatedMode: "batch" },
  );

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//projects/apps/sample-app:latency-guardrail"],
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
      name: "enforcement",
      targets: ["//:linting_process_inspection_commands_enforcement"],
    },
    {
      name: "shared",
      targets: ["//projects/apps/sample-app:unit"],
    },
  ]);
});

test("verify target passes batch isolated targets by default", () => {
  const passes = planVerifyTargetPasses([
    { target: "//projects/apps/sample-app:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//projects/apps/sample-app:unit", labels: ["kind:test"] },
    {
      target: "//:deployments_nixos_shared_host_reuse_e2e",
      labels: ["kind:test", VERIFY_RESOURCE_LIMITED_LABEL],
    },
    {
      target: "//:scaffolding_webapp_ssr_next_contracts",
      labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
    },
    {
      target: "//:linting_process_inspection_commands_enforcement",
      labels: ["kind:test", VERIFY_ENFORCEMENT_LABEL],
    },
  ]);

  assert.deepEqual(passes, [
    {
      name: "isolated",
      targets: ["//projects/apps/sample-app:latency-guardrail"],
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
      name: "enforcement",
      targets: ["//:linting_process_inspection_commands_enforcement"],
    },
    {
      name: "shared",
      targets: ["//projects/apps/sample-app:unit"],
    },
  ]);
});

test("verify target passes keep isolated labels stricter than concurrent pass labels", () => {
  const passes = planVerifyTargetPasses([
    {
      target: "//:startup_sensitive",
      labels: [
        VERIFY_ISOLATED_LABEL,
        VERIFY_BOUNDED_ISOLATED_LABEL,
        VERIFY_ENFORCEMENT_LABEL,
        VERIFY_RESOURCE_LIMITED_LABEL,
      ],
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
      { target: "//projects/apps/sample-app:latency-guardrail", labels: [VERIFY_ISOLATED_LABEL] },
      {
        target: "//:scaffolding_webapp_ssr_next_contracts",
        labels: ["kind:test", VERIFY_BOUNDED_ISOLATED_LABEL],
      },
    ],
    { isolatedMode: "per-target" },
  );

  assert.deepEqual(passes, [
    {
      name: "isolated://projects/apps/sample-app:latency-guardrail",
      targets: ["//projects/apps/sample-app:latency-guardrail"],
      threadsOverride: 1,
    },
    {
      name: "isolated-bounded",
      targets: ["//:scaffolding_webapp_ssr_next_contracts"],
      threadsOverride: VERIFY_BOUNDED_ISOLATED_THREADS,
    },
  ]);
});

test("verify target pass execution starts enforcement beside the first isolated lane", () => {
  const passes = planVerifyTargetPasses([
    { target: "//:startup_sensitive", labels: [VERIFY_ISOLATED_LABEL] },
    { target: "//:fixture_heavy", labels: [VERIFY_BOUNDED_ISOLATED_LABEL] },
    { target: "//:resource_heavy", labels: [VERIFY_RESOURCE_LIMITED_LABEL] },
    { target: "//:policy_guard", labels: [VERIFY_ENFORCEMENT_LABEL] },
    { target: "//:ordinary", labels: ["kind:test"] },
  ]);

  assert.deepEqual(
    groupVerifyPassesForExecution(passes).map((group) => group.map((pass) => pass.name)),
    [["isolated", "enforcement"], ["isolated-bounded"], ["resource-limited", "shared"]],
  );
});

test("verify target pass execution keeps enforcement concurrent when there is no isolated lane", () => {
  const passes = planVerifyTargetPasses([
    { target: "//:resource_heavy", labels: [VERIFY_RESOURCE_LIMITED_LABEL] },
    { target: "//:policy_guard", labels: [VERIFY_ENFORCEMENT_LABEL] },
    { target: "//:ordinary", labels: ["kind:test"] },
  ]);

  assert.deepEqual(
    groupVerifyPassesForExecution(passes).map((group) => group.map((pass) => pass.name)),
    [["resource-limited", "shared", "enforcement"]],
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

test("resource-limited pass start delay defaults to no timed overlap", () => {
  assert.equal(
    resourceLimitedStartDelaySeconds(
      [
        { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
        { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
      ],
      {},
    ),
    0,
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

test("broad staged verify groups finish bounded lanes before shared by default", () => {
  const staged = splitVerifyPassGroupForStagedStart(
    [
      { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
      { name: "enforcement", targets: ["//:policy_guard"] },
      { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
    ],
    {},
  );

  assert.equal(staged.delaySeconds, 0);
  assert.equal(staged.waitForImmediatePassesBeforeDelayed, true);
  assert.deepEqual(
    staged.immediatePasses.map((pass) => pass.name),
    ["resource-limited", "enforcement"],
  );
  assert.deepEqual(
    staged.delayedPasses.map((pass) => pass.name),
    ["shared"],
  );
});

test("explicit resource-limited pass start delay preserves timed overlap", () => {
  const staged = splitVerifyPassGroupForStagedStart(
    [
      { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
      { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
    ],
    { VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS: "17" },
  );

  assert.equal(staged.delaySeconds, 17);
  assert.equal(staged.waitForImmediatePassesBeforeDelayed, false);
  assert.deepEqual(
    staged.immediatePasses.map((pass) => pass.name),
    ["shared"],
  );
  assert.deepEqual(
    staged.delayedPasses.map((pass) => pass.name),
    ["resource-limited"],
  );
});

test("explicit zero resource-limited pass delay keeps immediate concurrent scheduling", () => {
  const staged = splitVerifyPassGroupForStagedStart(
    [
      { name: "resource-limited", targets: Array.from({ length: 50 }, (_, i) => `//:r${i}`) },
      { name: "shared", targets: Array.from({ length: 500 }, (_, i) => `//:s${i}`) },
    ],
    { VBR_VERIFY_RESOURCE_LIMITED_START_DELAY_SECS: "0" },
  );

  assert.equal(staged.delaySeconds, 0);
  assert.equal(staged.waitForImmediatePassesBeforeDelayed, false);
  assert.deepEqual(
    staged.immediatePasses.map((pass) => pass.name),
    ["resource-limited", "shared"],
  );
  assert.deepEqual(staged.delayedPasses, []);
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

test("verify marks pass and nested Buck isolation roots before spawning Buck", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-pass-isolation-metadata-"));
  try {
    await prepareVerifyBuckIsolationMetadata({
      root,
      passIso: "v-123-resource-limited",
      nestedIso: "verify-nested-123-deadbeefcafe",
      platform: "darwin",
    });

    for (const rel of [
      "buck-out",
      "buck-out/v-123-resource-limited",
      "buck-out/v-123-resource-limited/forkserver",
      "buck-out/v-123-resource-limited/test-logs",
      "buck-out/v-123-resource-limited/tmp",
      "buck-out/verify-nested-123-deadbeefcafe",
      "buck-out/verify-nested-123-deadbeefcafe/forkserver",
      "buck-out/verify-nested-123-deadbeefcafe/test-logs",
      "buck-out/verify-nested-123-deadbeefcafe/tmp",
    ]) {
      assert.ok(
        (await fsp.stat(path.join(root, rel, MACOS_METADATA_NEVER_INDEX_FILE))).isFile(),
        rel,
      );
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
