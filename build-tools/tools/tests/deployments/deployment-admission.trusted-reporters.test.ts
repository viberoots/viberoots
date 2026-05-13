#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

test("admission enforces trusted reporter identities for required checks", async () => {
  const base = nixosSharedHostDeploymentFixture();
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...base.admissionPolicy,
      requiredChecks: ["ci/deploy-ready"],
    },
  });
  const admittedContext = admittedContextFixture(deployment, { sourceRevision: "rev-trusted" });
  const check = {
    name: "ci/deploy-ready",
    subject: admittedContext.source.sourceRevision,
    status: "passed" as const,
    checkedAt: "2026-04-06T12:00:00.000Z",
    deploymentId: deployment.deploymentId,
    environmentStage: deployment.environmentStage,
    admissionPolicyRef: deployment.admissionPolicyRef,
  };
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
          checks: [check],
        },
      }),
    }),
    /requires trusted reporter/,
  );
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
          checks: [{ ...check, reporterIdentity: "ci:untrusted" }],
        },
      }),
    }),
    /ci:untrusted/,
  );
  const trustedReporter = deployment.lanePolicy.governance.trustedReporterIdentities[0];
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: {
        ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
        checks: [{ ...check, reporterIdentity: trustedReporter }],
      },
    }),
  });
  assert.equal(evaluation.requiredChecks[0]?.reporterIdentity, trustedReporter);
});
