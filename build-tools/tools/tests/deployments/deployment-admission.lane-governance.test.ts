#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { evaluateDeploymentAdmission } from "../../deployments/deployment-admission-evaluator.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { nixosSharedHostLaneGovernanceFixture } from "./deployment-lane-governance.fixture.ts";

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
        scmBackend: governance.scmBackend,
        repository: governance.repository,
        branchProtections: governance.branchProtections,
      },
    },
  });
  assert.equal(evaluation.laneGovernance?.governanceRef, deployment.lanePolicy.governanceRef);
  assert.equal(evaluation.laneGovernance?.branchProtections[0]?.branch, "env/pleomino/dev");
});
