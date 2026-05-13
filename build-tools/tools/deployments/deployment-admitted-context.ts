#!/usr/bin/env zx-wrapper
import type { DeploymentCompatibilityExceptionEvidence } from "./deployment-admission-evidence";
import type { DeploymentRunRecordLike } from "./deployment-admission-records";

export type AdmittedContextLike = {
  source: {
    sourceRevision: string;
    artifactIdentity?: string;
    sourceRunId?: string;
  };
  targetEnvironment: {
    providerTargetIdentity: string;
  };
  phase0CompatibilityException?: DeploymentCompatibilityExceptionEvidence;
};

export function sourceRevisionFor(
  admittedContext: AdmittedContextLike,
  sourceRecord?: DeploymentRunRecordLike,
) {
  const replayRevision = (sourceRecord as any)?.admittedContext?.source?.sourceRevision;
  return typeof replayRevision === "string" && replayRevision.trim()
    ? replayRevision.trim()
    : admittedContext.source.sourceRevision;
}
