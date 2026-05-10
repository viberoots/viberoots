#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator";
import { createServiceOwnedLaneGovernanceResolver } from "../../deployments/deployment-lane-governance-service";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";
import {
  nixosSharedHostLaneGovernanceFixture,
  reviewedLaneAdmissionEvidenceFixture,
} from "./deployment-lane-governance.fixture";

function admittedContextFixture() {
  return {
    source: { sourceRevision: "rev-source-123", artifactIdentity: "artifact-123" },
    targetEnvironment: { providerTargetIdentity: "nixos-shared-host:default:demoapp" },
  };
}

test("admission rejects protected/shared deploys without lane-governance verification", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
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
      admittedContext: admittedContextFixture(),
      evidence: { requestedBy: { principalId: "user:submitter" } },
    }),
    /requires governance verification/,
  );
});

test("admission rejects lane-governance drift", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const governance = nixosSharedHostLaneGovernanceFixture();
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
      admittedContext: admittedContextFixture(),
      evidence: {
        requestedBy: { principalId: "user:submitter" },
        laneGovernance: {
          lanePolicyRef: deployment.lanePolicyRef,
          governanceRef: deployment.lanePolicy.governanceRef,
          governanceFingerprint: governance.fingerprint,
          verifiedAt: "2026-04-10T12:00:00.000Z",
          verificationSource: "client_supplied",
          scmBackend: governance.scmBackend,
          repository: governance.repository,
          branchProtections: governance.branchProtections.map((entry) =>
            entry.stage === "dev" ? { ...entry, fastForwardOnly: false as never } : entry,
          ),
        },
      },
    }),
    /fast-forward-only enforcement is missing/,
  );
});

test("admission preserves successful lane-governance facts in policy evaluation", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const governance = deployment.lanePolicy.governance;
  const evaluation = await evaluateDeploymentAdmission({
    workspaceRoot: process.cwd(),
    recordsRoot: path.join(process.cwd(), ".local", "deployments", "nixos-shared-host", "records"),
    deployment,
    operationKind: "deploy",
    admittedContext: admittedContextFixture(),
    evidence: {
      requestedBy: { principalId: "user:submitter" },
      laneGovernance: {
        lanePolicyRef: deployment.lanePolicyRef,
        governanceRef: deployment.lanePolicy.governanceRef,
        governanceFingerprint: governance.fingerprint,
        verifiedAt: "2026-04-10T12:00:00.000Z",
        verificationSource: "client_supplied",
        scmBackend: governance.scmBackend,
        repository: governance.repository,
        branchProtections: governance.branchProtections,
      },
    },
  });
  assert.equal(evaluation.laneGovernance?.governanceRef, deployment.lanePolicy.governanceRef);
  assert.equal(evaluation.laneGovernance?.branchProtections[0]?.branch, "env/pleomino/dev");
  assert.equal(evaluation.laneGovernance?.verificationSource, "client_supplied");
});

test("admission can synthesize service-owned lane-governance facts", async () => {
  const deployment = nixosSharedHostDeploymentFixture();
  const evaluation = await evaluateDeploymentAdmission({
    workspaceRoot: process.cwd(),
    recordsRoot: path.join(process.cwd(), ".local", "deployments", "nixos-shared-host", "records"),
    deployment,
    operationKind: "deploy",
    admittedContext: admittedContextFixture(),
    evidence: {
      checks: [
        {
          name: "deploy/pleomino-dev",
          subject: "rev-source-123",
          status: "passed",
          checkedAt: "2026-04-10T12:00:00.000Z",
        },
      ],
    },
    governanceResolver: createServiceOwnedLaneGovernanceResolver({
      localFixture: true,
      env: {
        VBR_DEPLOY_GITHUB_GOVERNANCE_FIXTURE_JSON: JSON.stringify({
          scmBackend: "github",
          repository: deployment.lanePolicy.governance.repository,
          branchProtections: deployment.lanePolicy.governance.branchProtections,
        }),
      } as NodeJS.ProcessEnv,
    }),
  });
  assert.equal(evaluation.laneGovernance?.governanceRef, deployment.lanePolicy.governanceRef);
  assert.equal(evaluation.laneGovernance?.verificationSource, "service_verified");
});

test("explicit governance evidence remains valid when automatic verification is unavailable", async () => {
  const base = nixosSharedHostDeploymentFixture();
  const deployment = nixosSharedHostDeploymentFixture({
    lanePolicy: {
      ...base.lanePolicy,
      governance: {
        ...base.lanePolicy.governance,
        scmBackend: "gitlab",
      },
    },
  });
  const evaluation = await evaluateDeploymentAdmission({
    workspaceRoot: process.cwd(),
    recordsRoot: path.join(process.cwd(), ".local", "deployments", "nixos-shared-host", "records"),
    deployment,
    operationKind: "deploy",
    admittedContext: admittedContextFixture(),
    evidence: {
      ...reviewedLaneAdmissionEvidenceFixture({ deployment }),
      checks: [
        {
          name: "deploy/pleomino-dev",
          subject: "rev-source-123",
          status: "passed",
          checkedAt: "2026-04-10T12:00:00.000Z",
        },
      ],
    },
    governanceResolver: createServiceOwnedLaneGovernanceResolver(),
  });
  assert.equal(evaluation.laneGovernance?.verificationSource, "client_supplied");
});
