#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract.ts";
import { runNixosSharedHostExplicitRemoval } from "./nixos-shared-host-explicit-removal.ts";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";
import {
  acquireControlPlaneLock,
  readControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

export async function runNixosSharedHostControlPlaneWorker(opts: {
  submissionPath: string;
  executionSnapshotPath: string;
  workerId: string;
  deployRunId?: string;
  progressiveRollout?: NixosSharedHostControlPlaneSnapshot["progressiveRollout"];
  gateEvaluator?: NixosSharedHostGateEvaluator;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  const authority = {
    kind: "control-plane-worker" as const,
    submissionId: snapshot.submissionId,
    submissionPath: opts.submissionPath,
    workerId: opts.workerId,
    lockScope: snapshot.lockScope,
    executionSnapshotPath: opts.executionSnapshotPath,
  };
  return snapshot.action.kind === "deploy"
    ? await runNixosSharedHostStaticDeploy({
        deployment: snapshot.deployment,
        operationKind:
          snapshot.operationKind === "retry" ||
          snapshot.operationKind === "rollback" ||
          snapshot.operationKind === "promotion" ||
          snapshot.operationKind === "provision_only"
            ? snapshot.operationKind
            : "deploy",
        ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
        publishBehavior: snapshot.action.publishBehavior,
        ...(snapshot.action.publishInput
          ? snapshot.action.publishInput.kind === "exact-artifact"
            ? { artifact: snapshot.action.publishInput.artifact }
            : {
                componentArtifacts: snapshot.action.publishInput.components,
                compositeArtifactIdentity: snapshot.action.publishInput.compositeArtifactIdentity,
              }
          : {}),
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(snapshot.action.parentRunId ? { parentRunId: snapshot.action.parentRunId } : {}),
        ...(snapshot.action.releaseLineageId
          ? { releaseLineageId: snapshot.action.releaseLineageId }
          : {}),
        ...(snapshot.action.artifactLineageId
          ? { artifactLineageId: snapshot.action.artifactLineageId }
          : {}),
        ...(snapshot.action.recordedComponentResults
          ? { sourceComponentResults: snapshot.action.recordedComponentResults }
          : {}),
        ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
        ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext } : {}),
        ...(snapshot.recordedReleaseActions
          ? { releaseActions: snapshot.recordedReleaseActions }
          : {}),
        ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
        ...(snapshot.provisionerPlan ? { provisionerPlan: snapshot.provisionerPlan } : {}),
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        ...(snapshot.smokeConnectOverride
          ? { smokeConnectOverride: snapshot.smokeConnectOverride }
          : {}),
        ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
        authority,
      })
    : await runNixosSharedHostExplicitRemoval({
        deployment: snapshot.deployment,
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
        ...(snapshot.provisionerPlan ? { provisionerPlan: snapshot.provisionerPlan } : {}),
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        authority,
      });
}

export async function acquireNixosSharedHostControlPlaneLocks(
  recordsRoot: string,
  deployment: Parameters<typeof nixosSharedHostLockScopes>[0],
) {
  const releaseLocks: Array<() => Promise<void>> = [];
  try {
    for (const lockScope of nixosSharedHostLockScopes(deployment)) {
      releaseLocks.push(await acquireControlPlaneLock(recordsRoot, lockScope));
    }
  } catch (error) {
    for (const release of releaseLocks.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releaseLocks.reverse()) await release();
  };
}
