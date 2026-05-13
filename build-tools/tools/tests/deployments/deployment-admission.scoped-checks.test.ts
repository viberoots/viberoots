#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

const CHECK_NAME = "deploy/admission";

function requiredCheckDeployment(overrides = {}) {
  return nixosSharedHostDeploymentFixture({
    ...overrides,
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: [CHECK_NAME],
      ...(overrides as { admissionPolicy?: object }).admissionPolicy,
    },
  });
}

function scopedCheck(
  deployment: ReturnType<typeof nixosSharedHostDeploymentFixture>,
  subject: string,
) {
  return {
    name: CHECK_NAME,
    subject,
    status: "passed" as const,
    checkedAt: "2026-04-06T12:00:00.000Z",
    deploymentId: deployment.deploymentId,
    environmentStage: deployment.environmentStage,
    admissionPolicyRef: deployment.admissionPolicyRef,
    recordRef: `check://${CHECK_NAME}`,
    reporterIdentity:
      deployment.lanePolicy.governance.trustedReporterIdentities[0] || "app:deploy-bot",
  };
}

function stagedDeployment(stage: "staging" | "prod") {
  return requiredCheckDeployment({
    deploymentId: `demoapp-${stage}`,
    label: `//projects/deployments/demoapp-${stage}:deploy`,
    environmentStage: stage,
    admissionPolicyRef: `//projects/deployments/pleomino-shared:${stage}_release`,
    admissionPolicy: {
      ref: `//projects/deployments/pleomino-shared:${stage}_release`,
      name: `${stage}_release`,
      allowedRefs: [stage === "prod" ? "refs/tags/release/*" : "main"],
    },
  });
}

test("dev-scoped deploy/admission evidence does not satisfy prod", async () => {
  const devDeployment = requiredCheckDeployment({ deploymentId: "demoapp-dev" });
  const prodDeployment = stagedDeployment("prod");
  const admittedContext = admittedContextFixture(prodDeployment, {
    sourceRevision: "shared-revision-123",
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment: prodDeployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment: prodDeployment }),
          checks: [scopedCheck(devDeployment, admittedContext.source.sourceRevision)],
        },
      }),
    }),
    /requires check deploy\/admission/,
  );
});

test("staging-scoped deploy/admission evidence satisfies staging", async () => {
  const deployment = stagedDeployment("staging");
  const admittedContext = admittedContextFixture(deployment);
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
        checks: [scopedCheck(deployment, admittedContext.source.sourceRevision)],
      },
    }),
  });
  assert.equal(evaluation.requiredChecks[0]?.name, CHECK_NAME);
  assert.equal(evaluation.requiredChecks[0]?.deploymentId, deployment.deploymentId);
  assert.equal(evaluation.requiredChecks[0]?.environmentStage, "staging");
});

test("prod-scoped deploy/admission evidence satisfies prod", async () => {
  const deployment = stagedDeployment("prod");
  const admittedContext = admittedContextFixture(deployment);
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
        checks: [scopedCheck(deployment, admittedContext.source.sourceRevision)],
      },
    }),
  });
  assert.equal(evaluation.requiredChecks[0]?.name, CHECK_NAME);
  assert.equal(evaluation.requiredChecks[0]?.deploymentId, deployment.deploymentId);
  assert.equal(evaluation.requiredChecks[0]?.environmentStage, "prod");
});
