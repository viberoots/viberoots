#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { normalizeAdmissionEvidence } from "../../deployments/deployment-admission-evidence";
import { extractDeploymentAdmissionPolicies } from "../../deployments/deployment-policy";
import type { DeploymentReadinessGateType } from "../../deployments/deployment-readiness-gates";
import { admissionEvalBase, admittedContextFixture } from "./deployment-admission.test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

const READINESS_GATE_TYPES: DeploymentReadinessGateType[] = [
  "ragie_acl_semantics",
  "tenant_leak_check",
  "workos_mcp_auth",
  "storage_grant_lifecycle",
  "fetch_full_document_grant_lifecycle",
  "connect_metadata_shape",
  "connect_oauth_flow",
  "connect_source_update",
  "scoped_source_enforcement",
  "connect_branding_observation",
  "connect_limitation_decision",
  "connect_acl_review",
  "github_selected_repository_install",
  "github_permissions",
  "github_token_hygiene",
  "github_refresh_semantics",
  "github_retrieval_bakeoff",
  "external_source_fetch_full_document_denial",
];

function gateName(type: DeploymentReadinessGateType) {
  return `live/${type}`;
}

function readinessDeployment(type: DeploymentReadinessGateType = "ragie_acl_semantics") {
  return nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      readinessGates: [
        {
          name: gateName(type),
          type,
          requiredFor: ["deploy"],
          gateVersion: "phase0-2026-05",
        },
      ],
    },
  });
}

function readinessEvidence(
  deployment: ReturnType<typeof readinessDeployment>,
  admittedContext: ReturnType<typeof admittedContextFixture>,
  type: DeploymentReadinessGateType = "ragie_acl_semantics",
  overrides: Record<string, string> = {},
) {
  return {
    name: gateName(type),
    type,
    status: "passed" as const,
    checkedAt: "2026-05-03T12:00:00.000Z",
    gateVersion: "phase0-2026-05",
    deploymentId: deployment.deploymentId,
    environmentStage: deployment.environmentStage,
    providerTargetIdentity: deployment.providerTarget.deploymentTargetIdentity,
    sourceRevision: admittedContext.source.sourceRevision,
    ...(admittedContext.source.sourceRunId
      ? { sourceRunId: admittedContext.source.sourceRunId }
      : {}),
    evidenceRef: `evidence://${type}/redacted`,
    redactedSummary: "live readiness gate passed",
    diagnostics: {
      summary: "pass count=12 fail count=0",
      reviewContextRef: `evidence://${type}/review`,
    },
    ...overrides,
  };
}

test("admission requires deployment-bound readiness gate evidence", async () => {
  const deployment = readinessDeployment();
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext: admittedContextFixture(deployment),
        evidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
      }),
    }),
    /requires readiness gate live\/ragie_acl_semantics/,
  );
});

for (const type of READINESS_GATE_TYPES) {
  test(`redacted readiness evidence satisfies ${type}`, async () => {
    const deployment = readinessDeployment(type);
    const admittedContext = admittedContextFixture(deployment);
    const evaluation = await evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
          readinessGates: [readinessEvidence(deployment, admittedContext, type)],
        },
      }),
    });
    assert.equal(evaluation.readinessGates[0]?.type, type);
  });
}

for (const [field, value] of [
  ["deploymentId", "other-deployment"],
  ["environmentStage", "other-stage"],
  ["providerTargetIdentity", "nixos-shared-host:other:demoapp"],
  ["sourceRevision", "other-revision"],
  ["sourceRunId", "other-run"],
  ["gateVersion", "phase0-old"],
] as const) {
  test(`readiness evidence rejects mismatched ${field}`, async () => {
    const deployment = readinessDeployment();
    const admittedContext = admittedContextFixture(deployment, { sourceRunId: "source-run-1" });
    await assert.rejects(
      evaluateDeploymentAdmission({
        ...admissionEvalBase("nixos-shared-host", {
          deployment,
          operationKind: "deploy",
          admittedContext,
          evidence: {
            ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
            readinessGates: [
              readinessEvidence(deployment, admittedContext, "ragie_acl_semantics", {
                [field]: value,
              }),
            ],
          },
        }),
      }),
      /requires readiness gate live\/ragie_acl_semantics/,
    );
  });
}

test("readiness evidence rejects expired gate evidence", async () => {
  const deployment = readinessDeployment();
  const admittedContext = admittedContextFixture(deployment);
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
          readinessGates: [
            readinessEvidence(deployment, admittedContext, "ragie_acl_semantics", {
              expiresAt: "2000-01-01T00:00:00.000Z",
            }),
          ],
        },
      }),
    }),
    /requires readiness gate live\/ragie_acl_semantics/,
  );
});

for (const missingField of ["redactedSummary", "diagnostics"] as const) {
  test(`typed readiness evidence rejects missing ${missingField}`, async () => {
    const deployment = readinessDeployment();
    const admittedContext = admittedContextFixture(deployment);
    const incompleteEvidence = {
      ...readinessEvidence(deployment, admittedContext, "ragie_acl_semantics"),
    } as Partial<ReturnType<typeof readinessEvidence>>;
    delete incompleteEvidence[missingField];
    await assert.rejects(
      evaluateDeploymentAdmission({
        ...admissionEvalBase("nixos-shared-host", {
          deployment,
          operationKind: "deploy",
          admittedContext,
          evidence: {
            ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
            readinessGates: [incompleteEvidence as ReturnType<typeof readinessEvidence>],
          },
        }),
      }),
      /requires readiness gate live\/ragie_acl_semantics/,
    );
  });
}

test("readiness evidence binds source client and policy dimensions", async () => {
  const deployment = nixosSharedHostDeploymentFixture({
    admissionPolicy: {
      ...nixosSharedHostDeploymentFixture().admissionPolicy,
      readinessGates: [
        {
          name: "phase0/drive-oauth-chatgpt",
          type: "connect_oauth_flow",
          requiredFor: ["deploy"],
          gateVersion: "phase0-2026-05",
          source: "drive",
          client: "chatgpt",
        },
      ],
    },
  });
  const admittedContext = admittedContextFixture(deployment);
  await assert.rejects(
    evaluateDeploymentAdmission({
      ...admissionEvalBase("nixos-shared-host", {
        deployment,
        operationKind: "deploy",
        admittedContext,
        evidence: {
          ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
          readinessGates: [
            {
              ...readinessEvidence(deployment, admittedContext, "connect_oauth_flow"),
              name: "phase0/drive-oauth-chatgpt",
              source: "notion",
              client: "chatgpt",
            },
          ],
        },
      }),
    }),
    /requires readiness gate phase0\/drive-oauth-chatgpt/,
  );
});
