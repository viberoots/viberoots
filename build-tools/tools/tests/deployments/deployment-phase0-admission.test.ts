#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { DeploymentTarget } from "../../deployments/contract";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { validatePhase0ReleaseRecords } from "../../deployments/deployment-phase0-release";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  admittedContextFixture,
  writeDeploymentPrerequisiteRecord,
} from "./deployment-admission.prerequisites.helpers";

function phase0Deployment(
  deploymentId: string,
  provider: string,
  prerequisites: DeploymentTarget["prerequisites"] = [],
): DeploymentTarget {
  return {
    deploymentId,
    label: `//fixture/deployments/${deploymentId}:deploy`,
    name: "deploy",
    provider,
    protectionClass: "production_facing",
    lanePolicyRef: "//fixture/deployments/shared:lane",
    lanePolicy: {
      ref: "//fixture/deployments/shared:lane",
      fingerprint: "sha256:lane",
      governanceRef: "//fixture/deployments/shared:lane_governance",
      governance: {
        scmBackend: "github",
        repository: "viberoots/viberoots",
        sourceRefPolicies: [],
        trustedReporterIdentities: ["app:deploy-bot"],
        requiredApprovalBoundaries: [],
        fingerprint: "sha256:governance",
      },
    },
    environmentStage: deploymentId.endsWith("-prod") ? "prod" : "staging",
    admissionPolicyRef: "//fixture/deployments/shared:prod_release",
    admissionPolicy: {
      ref: "//fixture/deployments/shared:prod_release",
      fingerprint: "sha256:admission",
      requiredChecks: [],
      requiredApprovals: [],
      supplyChainGates: [],
    },
    prerequisites,
    secretRequirements: [],
    runtimeConfigRequirements: deploymentId.startsWith("data-room-console-")
      ? [{ name: "data-room-web-base-url", step: "publish", contractId: "runtime://fixture" }]
      : [],
    releaseActions: [],
    targetExceptions: [],
    component: { kind: "service", target: "//fixture/apps/app:service_artifact" },
    components: [{ id: "default", kind: "service", target: "//fixture/apps/app:service_artifact" }],
    publisher: { type: provider === "vercel" ? "vercel-output" : "helm-release" },
    providerTarget: { providerTargetIdentity: `${provider}:${deploymentId}` },
  } as DeploymentTarget;
}

async function expectAdmissionRejects(
  deployment: DeploymentTarget,
  tmp: string,
  providers: Record<string, string>,
  pattern: RegExp,
) {
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: tmp,
      recordsRoot: path.join(tmp, ".local", "deployments", "kubernetes", "records"),
      deployment,
      prerequisiteProvidersByDeploymentId: providers,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(deployment),
      evidence: deploymentAdmissionEvidenceFixture({
        deployment,
        operationKind: "deploy",
        sourceRevision: "rev-source-123",
        artifactIdentity: "artifact-123",
      }),
    }),
    pattern,
  );
}

test("Phase 0 fixture admission blocks stale foundation migration evidence", async () => {
  const foundation = phase0Deployment("platform-foundation-staging", "opentofu");
  const worker = phase0Deployment("data-room-worker-staging", "kubernetes", [
    { deploymentId: foundation.deploymentId, mode: "health_gated" },
  ]);
  await runInTemp("phase0-fixture-foundation-drift", async (tmp) => {
    await writeDeploymentPrerequisiteRecord(tmp, foundation, "opentofu", {
      foundationMigration: true,
      sourceRevision: "old-rev",
    });
    await expectAdmissionRejects(
      worker,
      tmp,
      { [foundation.deploymentId]: "opentofu" },
      /foundation migration evidence is stale/,
    );
  });
});

test("Phase 0 release records reject source drift without reviewed exception", () => {
  const errors = validatePhase0ReleaseRecords([
    {
      deploymentId: "data-room-web-prod",
      sourceRevision: "rev-a",
      lanePolicyRef: "lane",
      artifactIdentity: "web-artifact",
      providerTargetIdentity: "kubernetes:web",
    },
    {
      deploymentId: "data-room-console-prod",
      sourceRevision: "rev-b",
      lanePolicyRef: "lane",
      artifactIdentity: "console-artifact",
      providerTargetIdentity: "vercel:console",
    },
  ]);
  assert.ok(
    errors.includes("data-room-console-prod source revision differs without reviewed exception"),
  );
});

test("Phase 0 release records accept expiring compatibility exceptions", () => {
  assert.deepEqual(
    validatePhase0ReleaseRecords([
      {
        deploymentId: "data-room-web-staging",
        sourceRevision: "rev-a",
        lanePolicyRef: "lane",
        artifactIdentity: "web-artifact",
        providerTargetIdentity: "kubernetes:web",
      },
      {
        deploymentId: "data-room-console-staging",
        sourceRevision: "hotfix",
        lanePolicyRef: "lane",
        artifactIdentity: "console-artifact",
        providerTargetIdentity: "vercel:console",
        compatibilityException: {
          reviewedBy: "release-owner",
          reason: "console hotfix remains compatible",
          expiresAt: "2099-05-31T00:00:00Z",
        },
      },
    ]),
    [],
  );
});
