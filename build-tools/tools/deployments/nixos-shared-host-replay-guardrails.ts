#!/usr/bin/env zx-wrapper
import { invalidatingTargetException } from "./deployment-target-exceptions";
import {
  readBackendLatestDeployRecordEnvelopeByDeploymentId,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend";
import {
  assertNixosSharedHostReleaseActionPhaseReplayAllowed,
  rollbackCompatibilityErrors,
} from "./nixos-shared-host-release-actions";
import type { DeploymentReleaseAction } from "./deployment-release-actions";
import type { NixosSharedHostDeployment } from "./contract";
import { nixosSharedHostDeploymentTargetIdentity } from "./nixos-shared-host-components";
import {
  nixosSharedHostRunnerIdentities,
  runnerIdentityCompatibilityErrors,
} from "./nixos-shared-host-provenance";
import {
  readNixosSharedHostReplaySnapshot,
  type NixosSharedHostReplaySnapshot,
} from "./nixos-shared-host-replay";
import { type NixosSharedHostDeployRecord } from "./nixos-shared-host-records";

function replayMismatch(field: string, expected: string, actual: string): string {
  return `${field} mismatch: current=${expected} source=${actual}`;
}

export function sameDeploymentReplayErrors(
  current: NixosSharedHostDeployment,
  source: NixosSharedHostDeployment,
): string[] {
  const errors: string[] = [];
  const currentTargetIdentity = nixosSharedHostDeploymentTargetIdentity(current);
  const sourceTargetIdentity = nixosSharedHostDeploymentTargetIdentity(source);
  const invalidatingException = invalidatingTargetException(
    current.targetExceptions,
    sourceTargetIdentity,
    currentTargetIdentity,
  );
  if (current.deploymentId !== source.deploymentId) {
    errors.push(replayMismatch("deploymentId", current.deploymentId, source.deploymentId));
  }
  if (current.label !== source.label) {
    errors.push(replayMismatch("deploymentLabel", current.label, source.label));
  }
  if (current.provider !== source.provider) {
    errors.push(replayMismatch("provider", current.provider, source.provider));
  }
  if (currentTargetIdentity !== sourceTargetIdentity) {
    errors.push(
      invalidatingException
        ? `recorded target binding ${sourceTargetIdentity} was invalidated by ${invalidatingException.ref}`
        : replayMismatch("providerTargetIdentity", currentTargetIdentity, sourceTargetIdentity),
    );
  }
  if (current.publisher.type !== source.publisher.type) {
    errors.push(replayMismatch("publisherType", current.publisher.type, source.publisher.type));
  }
  if (current.component.kind !== source.component.kind) {
    errors.push(replayMismatch("componentKind", current.component.kind, source.component.kind));
  }
  return errors;
}

export function replayRunnerCompatibilityErrors(opts: {
  deployment: NixosSharedHostDeployment;
  record: NixosSharedHostDeployRecord;
  replaySnapshot: NixosSharedHostReplaySnapshot;
}): string[] {
  const expected = nixosSharedHostRunnerIdentities(
    opts.deployment,
    opts.replaySnapshot.deployment.releaseActions || [],
  );
  return [
    ...runnerIdentityCompatibilityErrors(expected, opts.record.runnerIdentities),
    ...runnerIdentityCompatibilityErrors(expected, opts.replaySnapshot.runnerIdentities),
  ];
}

export function rollbackSourceEligibilityErrors(record: NixosSharedHostDeployRecord): string[] {
  const errors: string[] = [];
  if (record.finalOutcome !== "succeeded")
    errors.push(`non-success final outcome: ${record.finalOutcome}`);
  if (record.runClassification !== "deploy" && record.runClassification !== "promotion") {
    errors.push(`wrong run classification: ${record.runClassification}`);
  }
  if (record.publishMode !== "normal") errors.push(`wrong publish mode: ${record.publishMode}`);
  return errors;
}

export function recordedReplayPolicyErrors(opts: {
  operationKind: "retry" | "rollback";
  releaseActions: DeploymentReleaseAction[];
}): string[] {
  const errors: string[] = [];
  for (const phase of ["pre_publish", "post_publish_pre_smoke", "post_smoke"] as const) {
    try {
      assertNixosSharedHostReleaseActionPhaseReplayAllowed({
        operationKind: opts.operationKind,
        phase,
        releaseActions: opts.releaseActions,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

export async function latestSuccessfulNormalReplaySnapshot(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deploymentId: string;
  excludeRunId: string;
}): Promise<NixosSharedHostReplaySnapshot | undefined> {
  const latest = await readBackendLatestDeployRecordEnvelopeByDeploymentId(opts.backend, {
    deploymentId: opts.deploymentId,
    finalOutcome: "succeeded",
    runClassification: "deploy",
    excludeDeployRunId: opts.excludeRunId,
    requireReplaySnapshotPath: true,
  });
  if (!latest?.record.replaySnapshotPath) return undefined;
  return await readNixosSharedHostReplaySnapshot(latest.record.replaySnapshotPath);
}

export async function liveRollbackCompatibilityErrors(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deploymentId: string;
  sourceRunId: string;
}): Promise<string[]> {
  const latest = await latestSuccessfulNormalReplaySnapshot(opts);
  if (!latest) return [];
  if (!latest.releaseActionPlan?.length && latest.deployment.releaseActions.length > 0) {
    return ["latest successful replay snapshot is missing a recorded release-action plan"];
  }
  return rollbackCompatibilityErrors(latest.releaseActionPlan || latest.deployment.releaseActions);
}
