#!/usr/bin/env zx-wrapper
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  type NixosSharedHostControlPlaneOperationKind,
  type NixosSharedHostControlPlanePaths,
  type NixosSharedHostPublishBehavior,
  type NixosSharedHostControlPlaneSnapshot,
  type NixosSharedHostControlPlaneSubmission,
  type NixosSharedHostSmokeConnectOverride,
} from "./nixos-shared-host-control-plane-contract.ts";
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";
import {
  createNixosSharedHostControlPlaneSnapshot,
  createNixosSharedHostSubmissionId,
  createNixosSharedHostWorkerId,
  type NixosSharedHostControlPlaneSourceSelection,
} from "./nixos-shared-host-control-plane-snapshot.ts";
import { runNixosSharedHostExplicitRemoval } from "./nixos-shared-host-explicit-removal.ts";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy.ts";
import {
  acquireControlPlaneLock,
  executionSnapshotPathFor,
  readControlPlaneJson,
  submissionPathFor,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components.ts";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records.ts";

type SubmitHooks = {
  afterSnapshotWritten?: (snapshotPath: string) => Promise<void> | void;
  onLockAcquired?: () => Promise<void> | void;
};

type SubmitOpts = {
  workspaceRoot: string;
  operationKind: NixosSharedHostControlPlaneOperationKind;
  deployment: NixosSharedHostDeployment;
  paths: NixosSharedHostControlPlanePaths;
  deployBatchId?: string;
  artifactDir?: string;
  artifactDirsByComponentId?: Record<string, string>;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
  publishBehavior?: NixosSharedHostPublishBehavior;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  smokeConnectOverride?: NixosSharedHostSmokeConnectOverride;
  source?: NixosSharedHostControlPlaneSourceSelection;
  hooks?: SubmitHooks;
};

type SubmitResult = {
  submission: NixosSharedHostControlPlaneSubmission;
  submissionPath: string;
  executionSnapshotPath: string;
  lockScope: string;
  record: NixosSharedHostDeployRecord;
  recordPath: string;
};

async function runWorker(opts: {
  submissionPath: string;
  executionSnapshotPath: string;
  workerId: string;
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
          snapshot.operationKind === "promotion"
            ? snapshot.operationKind
            : "deploy",
        publishBehavior: snapshot.action.publishBehavior,
        ...(snapshot.action.publishInput.kind === "exact-artifact"
          ? { artifact: snapshot.action.publishInput.artifact }
          : {
              componentArtifacts: snapshot.action.publishInput.components,
              compositeArtifactIdentity: snapshot.action.publishInput.compositeArtifactIdentity,
            }),
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
        ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
        ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext } : {}),
        ...(snapshot.recordedReleaseActions
          ? { releaseActions: snapshot.recordedReleaseActions }
          : {}),
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        ...(snapshot.smokeConnectOverride
          ? { smokeConnectOverride: snapshot.smokeConnectOverride }
          : {}),
        authority,
      })
    : await runNixosSharedHostExplicitRemoval({
        deployment: snapshot.deployment,
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        authority,
      });
}

async function acquireControlPlaneLocks(recordsRoot: string, lockScopes: string[]) {
  const releaseLocks: Array<() => Promise<void>> = [];
  try {
    for (const lockScope of lockScopes) {
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

export async function submitNixosSharedHostControlPlaneRun(
  opts: SubmitOpts,
): Promise<SubmitResult> {
  const submissionId = createNixosSharedHostSubmissionId();
  const snapshot = await createNixosSharedHostControlPlaneSnapshot(opts, submissionId);
  const executionSnapshotPath = executionSnapshotPathFor(opts.paths.recordsRoot, submissionId);
  const submissionPath = submissionPathFor(opts.paths.recordsRoot, submissionId);
  await writeControlPlaneJson(executionSnapshotPath, snapshot);
  await opts.hooks?.afterSnapshotWritten?.(executionSnapshotPath);
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    releaseLock = await acquireControlPlaneLocks(
      opts.paths.recordsRoot,
      nixosSharedHostLockScopes(opts.deployment),
    );
  } catch (error) {
    const rejected = createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
      decision: "rejected",
      reason: "lock_conflict",
    });
    await writeControlPlaneJson(submissionPath, rejected);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission: rejected,
      submissionPath,
      executionSnapshotPath,
    });
  }
  const workerId = createNixosSharedHostWorkerId(submissionId);
  let submission = createNixosSharedHostControlPlaneSubmission(
    snapshot,
    executionSnapshotPath,
    { decision: "admitted", reason: "shared_nonprod" },
    workerId,
  );
  await writeControlPlaneJson(submissionPath, submission);
  try {
    await opts.hooks?.onLockAcquired?.();
    const result = await runWorker({ submissionPath, executionSnapshotPath, workerId });
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      resultRecordPath: result.recordPath,
      finalOutcome: result.record.finalOutcome,
    };
    await writeControlPlaneJson(submissionPath, submission);
    return {
      submission,
      submissionPath,
      executionSnapshotPath,
      lockScope: snapshot.lockScope,
      record: result.record,
      recordPath: result.recordPath,
    };
  } catch (error) {
    submission = {
      ...submission,
      completedAt: new Date().toISOString(),
      ...((error as any)?.recordPath ? { resultRecordPath: (error as any).recordPath } : {}),
      ...((error as any)?.record?.finalOutcome
        ? { finalOutcome: (error as any).record.finalOutcome }
        : {}),
    };
    await writeControlPlaneJson(submissionPath, submission);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      submission,
      submissionPath,
      executionSnapshotPath,
    });
  } finally {
    await releaseLock?.();
  }
}
