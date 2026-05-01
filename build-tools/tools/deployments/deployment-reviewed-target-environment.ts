#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import {
  snapshotReviewedSourceForSubmission,
  type DeploymentReviewedSourceSnapshot,
} from "./nixos-shared-host-reviewed-source-snapshot.ts";

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
  if (!deployment.admissionPolicy.allowedRefs.includes(sourceRef)) {
    throw new Error(
      `deployment admission policy ${deployment.admissionPolicyRef} does not allow source ref ${sourceRef}`,
    );
  }
  return sourceRef;
}

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  return String((out as any).stdout || "").trim();
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
    "Make sure the deployment branch is up to date and pushed before retrying.",
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
    (await gitStdout(opts.workspaceRoot, ["rev-parse", targetRef]));
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
