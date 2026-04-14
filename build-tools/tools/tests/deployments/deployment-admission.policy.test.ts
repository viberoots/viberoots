#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator.ts";
import {
  admissionBindingFixture,
  deploymentAdmissionEvidenceFixture,
} from "./deployment-admission.fixture.ts";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture.ts";

test("admission rejects deploys without required check evidence", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: ["ci/deploy-ready"],
    },
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext: admittedContextFixture(deployment),
      }),
    }),
    /requires check ci\/deploy-ready/,
  );
});

test("admission rejects revoked or self-approved protected/shared approval evidence", async () => {
  const deployment = cloudflarePagesDeploymentFixture({
    protectionClass: "production_facing",
    admissionPolicy: {
      ...cloudflarePagesDeploymentFixture().admissionPolicy,
      requiredApprovals: ["human/prod"],
    },
  });
  const admittedContext = {
    source: { sourceRevision: "rev-prod-123", artifactIdentity: "artifact-prod-123" },
    targetEnvironment: {
      providerTargetIdentity: deployment.providerTarget.deploymentTargetIdentity,
    },
  };
  const revokedEvidence = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    requiredApprovals: ["human/prod"],
    approvalStatus: "revoked",
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("cloudflare-pages", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: revokedEvidence,
      }),
    }),
    /requires approval human\/prod/,
  );
  const selfApproved = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    requiredApprovals: ["human/prod"],
    requestedBy: "user:same-person",
    approver: "user:same-person",
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("cloudflare-pages", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: selfApproved,
      }),
    }),
    /requires approval human\/prod/,
  );
});

test("retry may reuse approval only when policy explicitly allows same-lineage reuse", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredApprovals: ["human/retry"],
      retryApprovalReuse: "same_lineage",
    },
  });
  const admittedContext = admittedContextFixture(deployment, {
    artifactIdentity: "artifact-retry-123",
    sourceRunId: "deploy-retry-parent",
  });
  const binding = admissionBindingFixture({
    deployment,
    operationKind: "retry",
    sourceRevision: admittedContext.source.sourceRevision,
    sourceRunId: "deploy-retry-parent",
    artifactIdentity: admittedContext.source.artifactIdentity,
    artifactLineageId: "artifact-lineage-123",
  });
  const sourceRecord = {
    deployRunId: "deploy-retry-parent",
    deploymentId: deployment.deploymentId,
    artifactLineageId: "artifact-lineage-123",
    artifact: { identity: admittedContext.source.artifactIdentity },
    admittedContext: {
      source: { sourceRevision: admittedContext.source.sourceRevision },
      policyEvaluation: {
        evaluatedAt: "2026-04-06T12:00:00.000Z",
        requestedBy: { principalId: "user:submitter" },
        binding,
        requiredChecks: [],
        requiredApprovals: [
          {
            name: "human/retry",
            approvalId: "human-retry-1",
            approver: { principalId: "user:approver" },
            grantedAt: "2026-04-06T12:01:00.000Z",
            status: "fresh" as const,
          },
        ],
        prerequisites: [],
      },
    },
  };
  const evaluation = await evaluateDeploymentAdmission({
    ...admissionEvalBase("nixos-shared-host", {
      deployment,
      operationKind: "retry",
      admittedContext,
      sourceRecord,
      artifactLineageId: "artifact-lineage-123",
      evidence: reviewedLaneAdmissionEvidenceFixture({
        deployment,
        requestedBy: "user:submitter",
      }),
    }),
  });
  assert.equal(evaluation.requiredApprovals[0]?.status, "reused");
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment: {
          ...deployment,
          admissionPolicy: { ...deployment.admissionPolicy, retryApprovalReuse: "fresh_only" },
        },
        operationKind: "retry",
        admittedContext,
        sourceRecord,
        artifactLineageId: "artifact-lineage-123",
        evidence: reviewedLaneAdmissionEvidenceFixture({
          deployment,
          requestedBy: "user:submitter",
        }),
      }),
    }),
    /requires approval human\/retry/,
  );
});

test("approval binding fails closed when the reviewed provisioner plan fingerprint drifts", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredApprovals: ["human/dev"],
    },
  });
  const admittedContext = admittedContextFixture(deployment);
  const reviewed = deploymentAdmissionEvidenceFixture({
    deployment,
    operationKind: "deploy",
    sourceRevision: admittedContext.source.sourceRevision,
    artifactIdentity: admittedContext.source.artifactIdentity,
    requiredApprovals: ["human/dev"],
    provisionerPlanFingerprint: "sha256:reviewed-plan",
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewed,
          provisionerPlanFingerprint: "sha256:drifted-plan",
        },
      }),
    }),
    /requires approval human\/dev/,
  );
});

test("protected/shared routine admission rejects destructive built-in release actions", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    releaseActions: [
      {
        ref: "//projects/deployments/demoapp-shared:db_migration",
        type: "schema_migration",
        phase: "pre_publish",
        runCondition: "success_only",
        abortBehavior: "fail_run",
        dataCompatibility: "forward_only",
        replayPolicy: {
          deploy_publish_slice: "skip",
          retry: "rerun",
          rollback: "fail",
          promotion: "skip",
        },
        duplicateSafety: { retry: "control_plane_deduplicated" },
        operationKeys: { retry: "db-migration:${deploy_run_id}" },
        requiredSecretRequirementNames: [],
        requiredRuntimeConfigRequirementNames: [],
      },
    ],
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext: admittedContextFixture(deployment),
        evidence: { requestedBy: { principalId: "user:submitter" } },
      }),
    }),
    /rejects destructive built-in release_actions/,
  );
});
