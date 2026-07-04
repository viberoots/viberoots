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
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
    runtime: { appName: "sample-webapp", containerPort: 3000 },
    lanePolicy,
    prerequisites: [],
  });
  const staging = cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-staging",
    label: "//projects/deployments/sample-webapp/staging:deploy",
    lanePolicy,
    prerequisites: [{ deploymentId: "sample-webapp-dev", mode: "ordering_only" }],
  });
  const prod = cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-prod",
    label: "//projects/deployments/sample-webapp/prod:deploy",
    environmentStage: "prod",
    lanePolicy,
    providerTarget: {
      account: "web-platform-prod",
      project: "sample-webapp-prod-pages",
      id: "sample-webapp-prod-pages",
      canonicalUrl: "https://sample-webapp-prod-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-prod/sample-webapp-prod-pages",
    },
    admissionPolicyRef: "//projects/deployments/sample-webapp/shared:prod_release",
    admissionPolicy: {
      ...cloudflarePagesDeploymentFixture().admissionPolicy,
      ref: "//projects/deployments/sample-webapp/shared:prod_release",
      name: "prod_release",
      allowedRefs: ["refs/tags/release/*"],
    },
    prerequisites: [{ deploymentId: "sample-webapp-staging", mode: "health_gated" }],
  });
  return {
    changedPaths: ["projects/apps/sample-webapp/src/main.tsx"],
    directDeploymentIds: ["sample-webapp-dev", "sample-webapp-staging", "sample-webapp-prod"],
    selectedDeployments: [dev, staging, prod],
    reasonsByDeploymentId: {
      "sample-webapp-dev": [
        { kind: "component-project", paths: [], projects: ["projects/apps/sample-webapp"] },
      ],
      "sample-webapp-staging": [
        { kind: "component-project", paths: [], projects: ["projects/apps/sample-webapp"] },
      ],
      "sample-webapp-prod": [
        { kind: "component-project", paths: [], projects: ["projects/apps/sample-webapp"] },
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
    ["deploy-sample-webapp-dev", "deploy-sample-webapp-staging", "deploy-sample-webapp-prod"],
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
      if (deployment.deploymentId === "sample-webapp-staging") {
        const error = new Error("staging smoke failed");
        throw Object.assign(error, {
          record: {
            deployRunId: "deploy-sample-webapp-staging",
            operationKind: "deploy",
            runClassification: "deploy",
            finalOutcome: "smoke_failed_after_publish",
            deployBatchId: extra.deployBatchId,
          },
          recordPath: "/tmp/sample-webapp-staging.json",
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
  assert.equal(result.results[1]?.result?.record.deployRunId, "deploy-sample-webapp-staging");
  assert.equal(result.results[2]?.status, "blocked");
  assert.deepEqual(result.results[2]?.blockedBy, ["sample-webapp-staging"]);
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
