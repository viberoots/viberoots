#!/usr/bin/env zx-wrapper
import {
  readBackendDeployRecordByDeployRunId,
  readBackendDeployRecordBySubmissionId,
  readBackendCurrentStageState,
  readBackendCurrentStageStates,
  readBackendResourceGraphIndex,
  readBackendRollbackCandidates,
  readBackendStageStateAuditEvents,
  readBackendStageHistory,
  readBackendSubmissionByDeployRunId,
  readBackendSubmissionBySubmissionId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import { statusFromSubmission } from "./deployment-control-plane-status";
import { redactControlPlaneReadModel } from "./deployment-control-plane-read-redaction";

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

export async function readControlPlaneResourceGraph(
  backend: NixosSharedHostControlPlaneBackendTarget,
) {
  return redactControlPlaneReadModel(await readBackendResourceGraphIndex(backend));
}

export async function readControlPlaneCurrentStageState(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage: string },
) {
  return await readBackendCurrentStageState(backend, opts);
}

export async function readControlPlaneCurrentStageStates(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId?: string; environmentStage?: string },
) {
  return await readBackendCurrentStageStates(backend, opts);
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

export async function readControlPlaneStageStateAuditEvents(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage?: string },
) {
  return await readBackendStageStateAuditEvents(backend, opts);
}
