#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertFromChangesConflicts,
  resolveFromChangesOperationKind,
} from "../../deployments/deployment-from-changes-cli";
import { runDeploymentBatchFromChanges } from "../../deployments/deployment-from-changes-run";
import type { DeploymentFromChangesPlan } from "../../deployments/deployment-from-changes-selection";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import {
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";

function planForBatch(): DeploymentFromChangesPlan {
  const lanePolicy = nixosSharedHostLanePolicyFixture();
  const dev = nixosSharedHostDeploymentFixture({
    deploymentId: "pleomino-dev",
    label: "//projects/deployments/pleomino/dev:deploy",
    component: { kind: "static-webapp", target: "//projects/apps/pleomino:app" },
    runtime: { appName: "pleomino", containerPort: 3000 },
    lanePolicy,
    prerequisites: [],
  });
  const staging = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-staging",
    label: "//projects/deployments/pleomino/staging:deploy",
    lanePolicy,
    prerequisites: [{ deploymentId: "pleomino-dev", mode: "ordering_only" }],
  });
  const prod = cloudflarePagesDeploymentFixture({
    deploymentId: "pleomino-prod",
    label: "//projects/deployments/pleomino/prod:deploy",
    environmentStage: "prod",
    lanePolicy,
    providerTarget: {
      account: "web-platform-prod",
      project: "pleomino-prod-pages",
      id: "pleomino-prod-pages",
      canonicalUrl: "https://pleomino-prod-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-prod/pleomino-prod-pages",
    },
    admissionPolicyRef: "//projects/deployments/pleomino/shared:prod_release",
    admissionPolicy: {
      ...cloudflarePagesDeploymentFixture().admissionPolicy,
      ref: "//projects/deployments/pleomino/shared:prod_release",
      name: "prod_release",
      allowedRefs: ["refs/tags/release/*"],
    },
    prerequisites: [{ deploymentId: "pleomino-staging", mode: "health_gated" }],
  });
  return {
    changedPaths: ["projects/apps/pleomino/src/main.tsx"],
    directDeploymentIds: ["pleomino-dev", "pleomino-staging", "pleomino-prod"],
    selectedDeployments: [dev, staging, prod],
    reasonsByDeploymentId: {
      "pleomino-dev": [
        { kind: "component-project", paths: [], projects: ["projects/apps/pleomino"] },
      ],
      "pleomino-staging": [
        { kind: "component-project", paths: [], projects: ["projects/apps/pleomino"] },
      ],
      "pleomino-prod": [
        { kind: "component-project", paths: [], projects: ["projects/apps/pleomino"] },
      ],
    },
  };
}

test("grouped from-changes batches keep per-deployment run identity and shared deployBatchId", async () => {
  const result = await runDeploymentBatchFromChanges({
    plan: planForBatch(),
    group: true,
    runDeployment: async (deployment, extra) => ({
      record: {
        deployRunId: `deploy-${deployment.deploymentId}`,
        operationKind: "deploy",
        runClassification: "deploy",
        finalOutcome: "succeeded",
        deployBatchId: extra.deployBatchId,
      },
      recordPath: `/tmp/${deployment.deploymentId}.json`,
    }),
  });

  assert.match(result.deployBatchId ?? "", /^batch-/);
  assert.deepEqual(
    result.results.map((entry) => entry.result?.record.deployRunId),
    ["deploy-pleomino-dev", "deploy-pleomino-staging", "deploy-pleomino-prod"],
  );
  for (const entry of result.results) {
    assert.equal(entry.status, "succeeded");
    assert.equal(entry.result?.record.deployBatchId, result.deployBatchId);
  }
});

test("grouped from-changes failures stay attributable to one run and block health-gated dependents", async () => {
  const result = await runDeploymentBatchFromChanges({
    plan: planForBatch(),
    group: true,
    runDeployment: async (deployment, extra) => {
      if (deployment.deploymentId === "pleomino-staging") {
        const error = new Error("staging smoke failed");
        throw Object.assign(error, {
          record: {
            deployRunId: "deploy-pleomino-staging",
            operationKind: "deploy",
            runClassification: "deploy",
            finalOutcome: "smoke_failed_after_publish",
            deployBatchId: extra.deployBatchId,
          },
          recordPath: "/tmp/pleomino-staging.json",
        });
      }
      return {
        record: {
          deployRunId: `deploy-${deployment.deploymentId}`,
          operationKind: "deploy",
          runClassification: "deploy",
          finalOutcome: "succeeded",
          deployBatchId: extra.deployBatchId,
        },
        recordPath: `/tmp/${deployment.deploymentId}.json`,
      };
    },
  });

  assert.equal(result.results[0]?.status, "succeeded");
  assert.equal(result.results[1]?.status, "failed");
  assert.equal(result.results[1]?.result?.record.deployRunId, "deploy-pleomino-staging");
  assert.equal(result.results[2]?.status, "blocked");
  assert.deepEqual(result.results[2]?.blockedBy, ["pleomino-staging"]);
});

test("from-changes CLI remove mode is explicit and allows the grouped removal path", () => {
  const flags = new Set(["from-changes", "remove", "group"]);
  const hasFlag = (name: string) => flags.has(name);

  assert.equal(resolveFromChangesOperationKind(hasFlag), "remove");
  assert.doesNotThrow(() => assertFromChangesConflicts(hasFlag, "remove"));

  flags.add("rollback");
  assert.throws(
    () => assertFromChangesConflicts(hasFlag, "remove"),
    /--from-changes cannot be combined with --rollback/,
  );
});
