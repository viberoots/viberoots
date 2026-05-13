#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { requiredDeploymentStageBranch } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import {
  snapshotReviewedSourceForSubmission,
  type DeploymentReviewedSourceSnapshot,
} from "./nixos-shared-host-reviewed-source-snapshot";
import { resolveDeploymentGitCommit } from "./deployment-git-ref";
import { sourceRefAllowed } from "./deployment-source-ref-policy";

export type DeploymentReviewedTargetEnvironmentAdmission = {
  mode: "stage_branch_snapshot";
  targetRef: string;
  targetRevision: string;
  providerTargetIdentity: string;
  lockScope: string;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
};

function requiredPolicyRef(deployment: DeploymentTarget): string {
  const sourceRef = requiredDeploymentStageBranch(deployment);
  if (!sourceRefAllowed(sourceRef, deployment.admissionPolicy.allowedRefs)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  return sourceRef;
}

function reviewedSourceMismatchMessage(opts: {
  targetRef: string;
  expectedSourceRevision: string;
  targetRevision: string;
}) {
  return [
    `protected/shared reviewed source mismatch for ${opts.targetRef}`,
    `clientExpectedSourceRevision=${opts.expectedSourceRevision}`,
    `serviceReviewedSourceRevision=${opts.targetRevision}`,
    "The service fetched the reviewed deployment source ref before admission.",
    "Make sure that source ref is up to date and pushed before retrying.",
    `Rerun with --admit-for-commit ${opts.targetRevision} if ${opts.targetRevision} is intentionally the reviewed commit to deploy.`,
  ].join("\n");
}

export async function resolveDeploymentReviewedTargetEnvironment(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  submissionId?: string;
  expectedSourceRevision?: string;
  reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
  providerTargetIdentity?: string;
  lockScope?: string;
}): Promise<DeploymentReviewedTargetEnvironmentAdmission> {
  const targetRef = requiredPolicyRef(opts.deployment);
  const reviewedSourceSnapshot =
    opts.reviewedSourceSnapshot ||
    (opts.submissionId
      ? await snapshotReviewedSourceForSubmission({
          workspaceRoot: opts.workspaceRoot,
          deployment: opts.deployment,
          submissionId: opts.submissionId,
          ...(opts.expectedSourceRevision
            ? { expectedSourceRevision: opts.expectedSourceRevision }
            : {}),
        })
      : undefined);
  const targetRevision =
    reviewedSourceSnapshot?.sourceRevision ||
    (await resolveDeploymentGitCommit({
      workspaceRoot: opts.workspaceRoot,
      revision: targetRef,
      purpose: "deployment reviewed target ref",
    }));
  const expected = opts.expectedSourceRevision?.trim();
  if (expected && expected !== targetRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      reviewedSourceMismatchMessage({
        targetRef,
        expectedSourceRevision: expected,
        targetRevision,
      }),
    );
  }
  const providerTargetIdentity =
    opts.providerTargetIdentity || opts.deployment.providerTarget.providerTargetIdentity;
  return {
    mode: "stage_branch_snapshot",
    targetRef,
    targetRevision,
    providerTargetIdentity,
    lockScope: opts.lockScope || providerTargetIdentity,
    ...(reviewedSourceSnapshot ? { reviewedSourceSnapshot } : {}),
  };
}
