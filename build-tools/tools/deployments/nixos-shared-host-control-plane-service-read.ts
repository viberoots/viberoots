#!/usr/bin/env zx-wrapper
import {
  readBackendDeployRecordByDeployRunId,
  readBackendDeployRecordBySubmissionId,
  readBackendCurrentStageState,
  readBackendRollbackCandidates,
  readBackendStageHistory,
  readBackendSubmissionByDeployRunId,
  readBackendSubmissionBySubmissionId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { statusFromSubmission } from "./deployment-control-plane-status";

export async function readControlPlaneStatus(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    submissionId?: string;
    deployRunId?: string;
  },
) {
  const submission = opts.submissionId
    ? await readBackendSubmissionBySubmissionId(backend, opts.submissionId)
    : opts.deployRunId
      ? await readBackendSubmissionByDeployRunId(backend, opts.deployRunId)
      : null;
  return submission ? statusFromSubmission(submission as any) : null;
}

export async function readControlPlaneRecord(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    submissionId?: string;
    deployRunId?: string;
  },
) {
  return opts.submissionId
    ? await readBackendDeployRecordBySubmissionId(backend, opts.submissionId)
    : opts.deployRunId
      ? await readBackendDeployRecordByDeployRunId(backend, opts.deployRunId)
      : null;
}

export async function readControlPlaneCurrentStageState(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage: string },
) {
  return await readBackendCurrentStageState(backend, opts);
}

export async function readControlPlaneRollbackCandidates(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage: string },
) {
  return await readBackendRollbackCandidates(backend, opts);
}

export async function readControlPlaneStageHistory(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage?: string },
) {
  return await readBackendStageHistory(backend, opts);
}
