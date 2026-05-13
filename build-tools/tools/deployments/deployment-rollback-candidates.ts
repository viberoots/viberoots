#!/usr/bin/env zx-wrapper
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract";
import {
  readBackendCurrentStageState,
  readBackendStageHistory,
  type DeploymentCurrentStageState,
} from "./deployment-current-stage-state";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

export type DeploymentRollbackCandidate = {
  deployRunId: string;
  sourceRevision: string;
  artifactIdentity: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  updatedAt: string;
};

function targetErrors(deployment: DeploymentTarget, state: DeploymentCurrentStageState | null) {
  if (!state) {
    return [
      `current stage state is unavailable: ${deployment.deploymentId}:${deployment.environmentStage}`,
    ];
  }
  const errors: string[] = [];
  const targetIdentity = providerTargetIdentityFor(deployment);
  if (state.providerTargetIdentity !== targetIdentity) {
    errors.push(
      `current stage state provider target identity mismatch: current=${state.providerTargetIdentity} target=${targetIdentity}`,
    );
  }
  if (state.artifactReuseMode !== deployment.lanePolicy.artifactReuseMode) {
    errors.push(
      `current stage state artifact reuse mode mismatch: current=${state.artifactReuseMode} policy=${deployment.lanePolicy.artifactReuseMode}`,
    );
  }
  if (state.finalOutcome !== "succeeded") {
    errors.push(`current stage state is not successful: ${state.finalOutcome}`);
  }
  return errors;
}

function isRollbackCandidate(
  current: DeploymentCurrentStageState,
  entry: DeploymentCurrentStageState,
): boolean {
  return (
    entry.currentRunId !== current.currentRunId &&
    (entry.operationKind === "deploy" || entry.operationKind === "promotion") &&
    entry.finalOutcome === "succeeded" &&
    entry.providerTargetIdentity === current.providerTargetIdentity &&
    entry.artifactReuseMode === current.artifactReuseMode
  );
}

function candidateFrom(entry: DeploymentCurrentStageState): DeploymentRollbackCandidate {
  return {
    deployRunId: entry.currentRunId,
    sourceRevision: entry.sourceRevision,
    artifactIdentity: entry.artifactIdentity,
    ...(entry.parentRunId ? { parentRunId: entry.parentRunId } : {}),
    ...(entry.releaseLineageId ? { releaseLineageId: entry.releaseLineageId } : {}),
    ...(entry.artifactLineageId ? { artifactLineageId: entry.artifactLineageId } : {}),
    updatedAt: entry.updatedAt,
  };
}

export async function readBackendRollbackCandidates(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage: string },
): Promise<DeploymentRollbackCandidate[]> {
  const current = await readBackendCurrentStageState(backend, opts);
  if (!current) return [];
  const history = await readBackendStageHistory(backend, opts);
  return history.filter((entry) => isRollbackCandidate(current, entry)).map(candidateFrom);
}

export async function rollbackStageStateErrors(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deployment: DeploymentTarget;
  sourceRunId: string;
}): Promise<string[]> {
  const state = await readBackendCurrentStageState(opts.backend, {
    deploymentId: opts.deployment.deploymentId,
    environmentStage: opts.deployment.environmentStage,
  });
  const errors = targetErrors(opts.deployment, state);
  if (errors.length > 0 || !state) return errors;
  const candidates = await readBackendRollbackCandidates(opts.backend, {
    deploymentId: opts.deployment.deploymentId,
    environmentStage: opts.deployment.environmentStage,
  });
  if (!candidates.some((candidate) => candidate.deployRunId === opts.sourceRunId)) {
    errors.push(`source run is not a current rollback candidate: ${opts.sourceRunId}`);
  }
  return errors;
}
