#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator.ts";
import { providerTargetIdentityFor } from "../../deployments/contract.ts";
import {
  admissionBindingFixture,
  deploymentAdmissionEvidenceFixture,
} from "./deployment-admission.fixture.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

function admittedContextFixture(
  deployment: ReturnType<typeof nixosSharedHostDeploymentFixture>,
  overrides: Partial<{
    sourceRevision: string;
    artifactIdentity: string;
    sourceRunId: string;
  }> = {},
) {
  return {
    source: {
      sourceRevision: overrides.sourceRevision || "rev-source-123",
      artifactIdentity: overrides.artifactIdentity || "artifact-123",
      ...(overrides.sourceRunId ? { sourceRunId: overrides.sourceRunId } : {}),
    },
    targetEnvironment: {
      providerTargetIdentity: providerTargetIdentityFor(deployment),
    },
  };
}

test("admission rejects deploys without required check evidence", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      requiredChecks: ["ci/deploy-ready"],
    },
  });
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(
        process.cwd(),
        ".local",
        "deployments",
        "nixos-shared-host",
        "records",
      ),
      deployment,
      operationKind: "deploy",
      admittedContext: admittedContextFixture(deployment),
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
    targetEnvironment: { providerTargetIdentity: providerTargetIdentityFor(deployment) },
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
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(process.cwd(), ".local", "deployments", "cloudflare-pages", "records"),
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: revokedEvidence,
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
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(process.cwd(), ".local", "deployments", "cloudflare-pages", "records"),
      deployment,
      operationKind: "deploy",
      admittedContext,
      evidence: selfApproved,
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
    workspaceRoot: process.cwd(),
    recordsRoot: path.join(process.cwd(), ".local", "deployments", "nixos-shared-host", "records"),
    deployment,
    operationKind: "retry",
    admittedContext,
    sourceRecord,
    artifactLineageId: "artifact-lineage-123",
    evidence: { requestedBy: { principalId: "user:submitter" } },
  });
  assert.equal(evaluation.requiredApprovals[0]?.status, "reused");
  await assert.rejects(
    evaluateDeploymentAdmission({
      workspaceRoot: process.cwd(),
      recordsRoot: path.join(
        process.cwd(),
        ".local",
        "deployments",
        "nixos-shared-host",
        "records",
      ),
      deployment: {
        ...deployment,
        admissionPolicy: { ...deployment.admissionPolicy, retryApprovalReuse: "fresh_only" },
      },
      operationKind: "retry",
      admittedContext,
      sourceRecord,
      artifactLineageId: "artifact-lineage-123",
      evidence: { requestedBy: { principalId: "user:submitter" } },
    }),
    /requires approval human\/retry/,
  );
});
