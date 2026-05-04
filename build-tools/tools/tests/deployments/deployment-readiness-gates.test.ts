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
  "connect_metadata_oauth",
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
    deploymentId: deployment.deploymentId,
    providerTargetIdentity: deployment.providerTarget.deploymentTargetIdentity,
    sourceRevision: admittedContext.source.sourceRevision,
    ...(admittedContext.source.sourceRunId
      ? { sourceRunId: admittedContext.source.sourceRunId }
      : {}),
    evidenceRef: `evidence://${type}/redacted`,
    redactedSummary: "live readiness gate passed",
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
  ["providerTargetIdentity", "nixos-shared-host:other:demoapp"],
  ["sourceRevision", "other-revision"],
  ["sourceRunId", "other-run"],
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

test("normalization drops readiness evidence with raw provider payloads", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        name: "workos/mcp",
        type: "workos_mcp_auth",
        status: "passed",
        checkedAt: "2026-05-03T12:00:00.000Z",
        deploymentId: "console-staging",
        providerTargetIdentity: "vercel:web/console#staging",
        evidenceRef: "evidence://workos/mcp",
        providerResponse: { token: "must-not-serialize" },
      },
    ],
  });
  assert.equal(normalized?.readinessGates, undefined);
});

test("normalization drops readiness evidence with forbidden MCP source fields", () => {
  const normalized = normalizeAdmissionEvidence({
    readinessGates: [
      {
        name: "workos/mcp",
        type: "workos_mcp_auth",
        status: "passed",
        checkedAt: "2026-05-03T12:00:00.000Z",
        deploymentId: "console-staging",
        providerTargetIdentity: "vercel:web/console#staging",
        evidenceRef: "evidence://workos/mcp",
        metadata: { rawForensics: ["must-not-serialize"] },
      },
    ],
  });
  assert.equal(normalized?.readinessGates, undefined);
});

test("admission policy extraction rejects unsupported readiness gate metadata", () => {
  const result = extractDeploymentAdmissionPolicies([
    {
      name: "//projects/deployments/shared:prod_release",
      rule_type: "deployment_admission_policy",
      allowed_refs: ["env/prod"],
      readiness_gates: [
        {
          name: "bad/live-gate",
          type: "unknown_gate",
          required_for: "deploy,unknown_operation",
        },
      ],
    },
  ]);
  assert.equal(result.policies.size, 0);
  assert.ok(result.errors.some((entry) => entry.includes('unsupported type "unknown_gate"')));
  assert.ok(result.errors.some((entry) => entry.includes('required_for "unknown_operation"')));
});
