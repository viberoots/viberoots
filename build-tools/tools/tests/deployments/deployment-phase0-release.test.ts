#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeploymentTarget } from "../../deployments/contract";
import { runDeploymentBatchFromChanges } from "../../deployments/deployment-from-changes-run";
import type { DeploymentFromChangesPlan } from "../../deployments/deployment-from-changes-selection";
import {
  PHASE0_ADD_ORDER,
  PHASE0_REMOVE_ORDER,
  orderPhase0DeploymentsForRemoval,
  validatePhase0ReleaseContracts,
  validatePhase0ReleasePrerequisites,
  validatePhase0ReleaseRecords,
} from "../../deployments/deployment-phase0-release";

function deployment(
  deploymentId: string,
  prerequisites: Array<{ deploymentId: string; mode: "ordering_only" | "health_gated" }> = [],
): DeploymentTarget {
  return {
    deploymentId,
    label: `//projects/deployments/${deploymentId}:deploy`,
    lanePolicyRef: "//fixture/deployments/shared:lane",
    prerequisites,
  } as DeploymentTarget;
}

test("Phase 0 release order remains explicit for add and removal flows", () => {
  assert.deepEqual(PHASE0_ADD_ORDER, ["foundation", "worker", "web", "console"]);
  assert.deepEqual(PHASE0_REMOVE_ORDER, ["console", "web", "worker", "foundation"]);
});

test("Phase 0 removal ordering is applied to grouped execution", async () => {
  const unorderedDeployments = [
    deployment("platform-foundation-prod", [
      { deploymentId: "platform-foundation-staging", mode: "ordering_only" },
    ]),
    deployment("data-room-worker-prod", [
      { deploymentId: "platform-foundation-prod", mode: "health_gated" },
      { deploymentId: "data-room-worker-staging", mode: "ordering_only" },
    ]),
    deployment("data-room-console-prod", [
      { deploymentId: "data-room-web-prod", mode: "health_gated" },
      { deploymentId: "data-room-console-staging", mode: "ordering_only" },
    ]),
    deployment("data-room-web-prod", [
      { deploymentId: "data-room-worker-prod", mode: "health_gated" },
      { deploymentId: "data-room-web-staging", mode: "ordering_only" },
    ]),
  ];
  assert.deepEqual(
    unorderedDeployments.map((entry) => [
      entry.deploymentId,
      entry.prerequisites.map((prerequisite) => prerequisite.deploymentId).sort(),
    ]),
    [
      ["platform-foundation-prod", ["platform-foundation-staging"]],
      ["data-room-worker-prod", ["data-room-worker-staging", "platform-foundation-prod"].sort()],
      ["data-room-console-prod", ["data-room-console-staging", "data-room-web-prod"].sort()],
      ["data-room-web-prod", ["data-room-web-staging", "data-room-worker-prod"].sort()],
    ],
  );
  assert.deepEqual(
    orderPhase0DeploymentsForRemoval(unorderedDeployments).map((entry) => entry.deploymentId),
    [
      "data-room-console-prod",
      "data-room-web-prod",
      "data-room-worker-prod",
      "platform-foundation-prod",
    ],
  );
  const plan: DeploymentFromChangesPlan = {
    changedPaths: ["fixtures/deployments/data-room-console-prod/TARGETS"],
    directDeploymentIds: unorderedDeployments.map((entry) => entry.deploymentId),
    selectedDeployments: unorderedDeployments,
    reasonsByDeploymentId: {},
  };
  const executionOrder: string[] = [];
  const result = await runDeploymentBatchFromChanges({
    plan,
    group: true,
    operationKind: "remove",
    runDeployment: async (entry, extra) => {
      executionOrder.push(entry.deploymentId);
      return {
        record: {
          deployRunId: `remove-${entry.deploymentId}`,
          operationKind: "remove",
          runClassification: "remove",
          finalOutcome: "succeeded",
          deployBatchId: extra.deployBatchId,
        },
        recordPath: `/tmp/${entry.deploymentId}.json`,
      };
    },
  });
  assert.deepEqual(executionOrder, [
    "data-room-console-prod",
    "data-room-web-prod",
    "data-room-worker-prod",
    "platform-foundation-prod",
  ]);
  assert.deepEqual(result.deploymentOrder, executionOrder);
  assert.equal(result.operationKind, "remove");
});

test("Phase 0 prerequisite validation enforces component and lane promotion order", () => {
  const errors = validatePhase0ReleasePrerequisites([
    deployment("platform-foundation-dev"),
    deployment("data-room-worker-dev", [
      { deploymentId: "platform-foundation-dev", mode: "health_gated" },
    ]),
    deployment("data-room-web-dev"),
    deployment("data-room-console-dev", [
      { deploymentId: "data-room-web-dev", mode: "health_gated" },
    ]),
    deployment("data-room-worker-staging", [
      { deploymentId: "platform-foundation-staging", mode: "health_gated" },
    ]),
    deployment("platform-foundation-staging", [
      { deploymentId: "platform-foundation-dev", mode: "ordering_only" },
    ]),
  ]);

  assert.ok(
    errors.includes(
      "data-room-web-dev must health-gate data-room-worker-dev for Phase 0 add order",
    ),
  );
  assert.ok(
    errors.includes(
      "data-room-worker-staging must order after data-room-worker-dev for Phase 0 lane promotion",
    ),
  );
});

test("Phase 0 contract validation requires concrete readiness prerequisites", () => {
  const web = {
    ...deployment("data-room-web-prod"),
    component: { kind: "ssr-webapp", target: "//projects/apps/data-room-web:service_artifact" },
    runtimeConfigRequirements: [],
  } as DeploymentTarget;
  const console = {
    ...deployment("data-room-console-prod"),
    component: { kind: "ssr-webapp", target: "//projects/apps/data-room-console:vercel_artifact" },
    runtimeConfigRequirements: [{ name: "console-public-url" }],
    smoke: { runner: "http" },
  } as DeploymentTarget;
  const errors = validatePhase0ReleaseContracts([web, console]);

  assert.ok(errors.includes("data-room-web-prod must declare web API readiness config"));
  assert.ok(
    errors.includes("data-room-web-prod must declare Phase 0 smoke or release-health checks"),
  );
  assert.ok(errors.includes("data-room-console-prod must declare console-to-web base URL config"));
});

test("Phase 0 compatibility exception expiration must parse and remain active", () => {
  const record = {
    deploymentId: "data-room-console-prod",
    sourceRevision: "hotfix",
    lanePolicyRef: "lane",
    artifactIdentity: "console-artifact",
    providerTargetIdentity: "vercel:team/console#prod",
    compatibilityException: {
      reviewedBy: "release-owner",
      reason: "console-only hotfix",
      expiresAt: "not-a-date",
    },
  };
  assert.match(
    validatePhase0ReleaseRecords([
      {
        deploymentId: "data-room-web-prod",
        sourceRevision: "abc",
        lanePolicyRef: "lane",
        artifactIdentity: "web-artifact",
        providerTargetIdentity: "kubernetes:phase0/data-room-web#prod",
      },
      record,
    ]).join("\n"),
    /invalid expiration/,
  );
  assert.match(
    validatePhase0ReleaseRecords([
      {
        deploymentId: "data-room-web-prod",
        sourceRevision: "abc",
        lanePolicyRef: "lane",
        artifactIdentity: "web-artifact",
        providerTargetIdentity: "kubernetes:phase0/data-room-web#prod",
      },
      {
        ...record,
        compatibilityException: {
          ...record.compatibilityException,
          expiresAt: "2020-01-01T00:00:00Z",
        },
      },
    ]).join("\n"),
    /has expired/,
  );
});
