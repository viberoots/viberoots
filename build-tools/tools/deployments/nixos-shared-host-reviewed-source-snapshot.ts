#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import { deploymentGitStdout } from "./deployment-git-stdout";
import { requestedDeploymentReviewedSourceRef } from "./deployment-reviewed-source-ref";
import { explicitReviewedCommitSha } from "./deployment-source-ref-policy";
import { explicitReviewedCommitSnapshot } from "./deployment-reviewed-source-snapshot-explicit";
import {
  ensureReviewedSourceGitRepo,
  gitFetchEnvForReviewedRemote,
  resolveReviewedRemoteName,
  reviewedFetchTargetFor,
  trim,
} from "./nixos-shared-host-reviewed-source-git";

const execFileAsync = promisify(execFile);
export { gitFetchEnvForReviewedRemote } from "./nixos-shared-host-reviewed-source-git";

export type DeploymentReviewedSourceSnapshot = {
  reviewedRef: string;
  snapshotRef: string;
  sourceRevision: string;
  remoteName: string;
  repository: string;
  snapshottedAt: string;
};
type ReviewedSourceCarrier =
  | DeploymentReviewedSourceSnapshot
  | {
      reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
      admittedContext?: {
        targetEnvironment?: {
          reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
        };
      };
      targetEnvironment?: {
        reviewedSourceSnapshot?: DeploymentReviewedSourceSnapshot;
      };
    };

function snapshotRefFor(submissionId: string, reviewedRef: string): string {
  return `refs/vbr/reviewed-source/${submissionId}/${reviewedRef}`;
}

export async function snapshotReviewedSourceForSubmission(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  submissionId: string;
  expectedSourceRevision?: string;
  requestedSourceRef?: string;
}): Promise<DeploymentReviewedSourceSnapshot> {
  const reviewedRef = requestedDeploymentReviewedSourceRef({
    deployment: opts.deployment,
    requestedSourceRef: opts.requestedSourceRef,
  }).ref;
  const explicitCommitSha = explicitReviewedCommitSha(reviewedRef);
  if (explicitCommitSha) {
    return explicitReviewedCommitSnapshot({
      deployment: opts.deployment,
      reviewedRef,
      sourceRevision: explicitCommitSha,
      ...(opts.expectedSourceRevision
        ? { expectedSourceRevision: opts.expectedSourceRevision }
        : {}),
    });
  }
  await ensureReviewedSourceGitRepo(opts.workspaceRoot, opts.deployment);
  const remoteName = await resolveReviewedRemoteName(opts.workspaceRoot, opts.deployment);
  const snapshotRef = snapshotRefFor(opts.submissionId, reviewedRef);
  const fetchTarget = reviewedFetchTargetFor(opts.deployment, remoteName);
  const fetchEnv = await gitFetchEnvForReviewedRemote(opts.workspaceRoot, fetchTarget);
  try {
    await deploymentGitStdout(
      opts.workspaceRoot,
      ["fetch", "--no-tags", "--no-write-fetch-head", fetchTarget, `${reviewedRef}:${snapshotRef}`],
      fetchEnv.env,
    );
  } finally {
    await fetchEnv.cleanup();
  }
  const sourceRevision = await deploymentGitStdout(opts.workspaceRoot, [
    "rev-parse",
    `${snapshotRef}^{commit}`,
  ]);
  await execFileAsync("git", ["checkout", "--quiet", "--detach", sourceRevision], {
    cwd: opts.workspaceRoot,
  });
  const expectedSourceRevision = trim(opts.expectedSourceRevision);
  if (expectedSourceRevision && expectedSourceRevision !== sourceRevision) {
    await deleteGitRef(opts.workspaceRoot, snapshotRef);
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      [
        `protected/shared reviewed source mismatch for ${reviewedRef}`,
        `clientExpectedSourceRevision=${expectedSourceRevision}`,
        `serviceReviewedSourceRevision=${sourceRevision}`,
        `serviceRemote=${remoteName}`,
        "The service fetched the reviewed deployment source ref before admission.",
        "Make sure that source ref is up to date and pushed before retrying.",
        `Rerun with --admit-for-commit ${sourceRevision} if ${sourceRevision} is intentionally the reviewed commit to deploy.`,
      ].join("\n"),
    );
  }
  return {
    reviewedRef,
    snapshotRef,
    sourceRevision,
    remoteName,
    repository: trim(opts.deployment.lanePolicy.governance.repository),
    snapshottedAt: new Date().toISOString(),
  };
}

export function reviewedSourceSnapshotFrom(
  value: ReviewedSourceCarrier | undefined,
): DeploymentReviewedSourceSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("snapshotRef" in value && trim((value as { snapshotRef?: unknown }).snapshotRef)) {
    return value as DeploymentReviewedSourceSnapshot;
  }
  return (
    value.reviewedSourceSnapshot ||
    value.targetEnvironment?.reviewedSourceSnapshot ||
    value.admittedContext?.targetEnvironment?.reviewedSourceSnapshot
  );
}

export async function cleanupReviewedSourceSnapshot(
  workspaceRoot: string,
  value: ReviewedSourceCarrier | undefined,
): Promise<void> {
  const snapshot = reviewedSourceSnapshotFrom(value);
  const snapshotRef = trim(snapshot?.snapshotRef);
  if (!snapshotRef) return;
  await deleteGitRef(workspaceRoot, snapshotRef);
}

async function deleteGitRef(workspaceRoot: string, ref: string): Promise<void> {
  try {
    await execFileAsync("git", ["update-ref", "-d", ref], { cwd: workspaceRoot });
  } catch {}
}
