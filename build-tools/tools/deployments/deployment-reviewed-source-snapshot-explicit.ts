#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { DeploymentReviewedSourceSnapshot } from "./nixos-shared-host-reviewed-source-snapshot";

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function explicitReviewedCommitSnapshot(opts: {
  deployment: DeploymentTarget;
  reviewedRef: string;
  sourceRevision: string;
  expectedSourceRevision?: string;
}): DeploymentReviewedSourceSnapshot {
  const expectedSourceRevision = trim(opts.expectedSourceRevision);
  if (expectedSourceRevision && expectedSourceRevision !== opts.sourceRevision) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      [
        `protected/shared reviewed source mismatch for ${opts.reviewedRef}`,
        `clientExpectedSourceRevision=${expectedSourceRevision}`,
        `serviceReviewedSourceRevision=${opts.sourceRevision}`,
      ].join("\n"),
    );
  }
  return {
    reviewedRef: opts.reviewedRef,
    snapshotRef: opts.reviewedRef,
    sourceRevision: opts.sourceRevision,
    remoteName: "explicit-reviewed-commit",
    repository: trim(opts.deployment.lanePolicy.governance.repository),
    snapshottedAt: new Date().toISOString(),
  };
}
