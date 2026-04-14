#!/usr/bin/env zx-wrapper
import { cleanupCloudflarePagesPreview } from "./cloudflare-pages-preview-cleanup.ts";
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy.ts";
import {
  createCloudflarePagesDeployRunId,
  writeCloudflarePagesDeployRecord,
} from "./cloudflare-pages-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { revalidateControlPlaneAdmission } from "./deployment-control-plane-revalidation.ts";
import { lockWaitAbortReasonForSubmission } from "./deployment-control-plane-queue.ts";
import {
  acquireBackendControlPlaneLock,
  writeBackendDeployRecordDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import { removeMirrorFile } from "./nixos-shared-host-control-plane-backend-materialize.ts";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import {
  writeTransitionRecord,
  type CloudflarePagesTargetTransitionRecord,
} from "./cloudflare-pages-target-transition-records.ts";
import {
  createBackendPreviewCleanupRecord,
  sanitizedBackendRecord,
} from "./cloudflare-pages-control-plane-backend-records.ts";
// prettier-ignore
import { persistCloudflareBackendStatus, type CloudflareBackendSubmissionLike } from "./cloudflare-pages-control-plane-backend-status.ts";

export async function executeCloudflarePagesBackendSubmission(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  submissionPath: string;
  submissionRef: string;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  workerId: string;
}) {
  const submission = await readControlPlaneJson<CloudflareBackendSubmissionLike>(
    opts.submissionPath,
  );
  const snapshot = await readControlPlaneJson<any>(opts.executionSnapshotPath);
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope, {
    shouldAbort: async () => await lockWaitAbortReasonForSubmission(opts.submissionPath),
  });
  try {
    const running = { ...submission, lifecycleState: "running", workerId: opts.workerId };
    await persistCloudflareBackendStatus({
      backend: opts.backend,
      submissionPath: opts.submissionPath,
      submissionRef: opts.submissionRef,
      executionSnapshotRef: opts.executionSnapshotRef,
      submission: running,
    });
    if (snapshot.admittedContext) {
      await revalidateControlPlaneAdmission({
        workspaceRoot: opts.workspaceRoot,
        deployment: snapshot.deployment,
        admittedContext: snapshot.admittedContext,
      });
    }
    try {
      const result =
        snapshot.action?.kind === "preview_cleanup"
          ? await (async () => {
              try {
                await cleanupCloudflarePagesPreview({
                  deployment: snapshot.deployment,
                  effectiveRunTarget: snapshot.action.effectiveRunTarget,
                  providerReleaseId: snapshot.action.providerReleaseId,
                });
                const record = createBackendPreviewCleanupRecord({
                  deployment: snapshot.deployment,
                  submissionId: snapshot.submissionId,
                  workerId: opts.workerId,
                  lockScope: snapshot.lockScope,
                  admittedContext:
                    snapshot.sourceRecord?.admittedContext || snapshot.admittedContext,
                  artifactIdentity: snapshot.action.artifactIdentity,
                  artifactLineageId: snapshot.action.artifactLineageId,
                  ...(snapshot.action.parentRunId
                    ? { parentRunId: snapshot.action.parentRunId }
                    : {}),
                  ...(snapshot.action.releaseLineageId
                    ? { releaseLineageId: snapshot.action.releaseLineageId }
                    : {}),
                  effectiveRunTarget: snapshot.action.effectiveRunTarget,
                  sourceRunId: snapshot.action.previewIdentitySelector.sourceRunId,
                  cleanupReason: snapshot.action.cleanupReason,
                  finalOutcome: "succeeded",
                });
                return {
                  record,
                  recordPath: await writeCloudflarePagesDeployRecord(opts.recordsRoot, record),
                };
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const record = createBackendPreviewCleanupRecord({
                  deployment: snapshot.deployment,
                  submissionId: snapshot.submissionId,
                  workerId: opts.workerId,
                  lockScope: snapshot.lockScope,
                  admittedContext:
                    snapshot.sourceRecord?.admittedContext || snapshot.admittedContext,
                  artifactIdentity: snapshot.action.artifactIdentity,
                  artifactLineageId: snapshot.action.artifactLineageId,
                  effectiveRunTarget: snapshot.action.effectiveRunTarget,
                  sourceRunId: snapshot.action.previewIdentitySelector.sourceRunId,
                  cleanupReason: snapshot.action.cleanupReason,
                  finalOutcome: "publish_failed",
                  error: message,
                });
                const recordPath = await writeCloudflarePagesDeployRecord(opts.recordsRoot, record);
                throw Object.assign(error instanceof Error ? error : new Error(message), {
                  record,
                  recordPath,
                });
              }
            })()
          : snapshot.targetException
            ? await (async () => {
                const record: CloudflarePagesTargetTransitionRecord = {
                  schemaVersion: "cloudflare-pages-target-transition-record@1",
                  deployRunId: createCloudflarePagesDeployRunId("transition"),
                  operationKind: snapshot.operationKind,
                  runClassification: snapshot.operationKind,
                  finalOutcome: "succeeded",
                  deploymentId: snapshot.deployment.deploymentId,
                  deploymentLabel: snapshot.deployment.label,
                  provider: "cloudflare-pages",
                  providerTargetIdentity: snapshot.deployment.providerTarget.providerTargetIdentity,
                  oldProviderTargetIdentity: snapshot.targetException.oldProviderTargetIdentity,
                  ...(snapshot.targetException.newProviderTargetIdentity
                    ? {
                        newProviderTargetIdentity:
                          snapshot.targetException.newProviderTargetIdentity,
                      }
                    : {}),
                  sharedLockScope: snapshot.targetException.sharedLockScope,
                  requestedBy: running.requestedBy || { principalId: "service" },
                  authorization: running.authorization as any,
                  targetException: snapshot.targetException,
                  resultingOwnershipState:
                    snapshot.operationKind === "retire_target"
                      ? { kind: "retired", ownerDeploymentId: null }
                      : {
                          kind: "migrated",
                          ownerDeploymentId: snapshot.deployment.deploymentId,
                          providerTargetIdentity:
                            snapshot.deployment.providerTarget.providerTargetIdentity,
                        },
                  controlPlane: {
                    submissionId: snapshot.submissionId,
                    submissionPath: "",
                    executionSnapshotPath: "",
                    lockScope: snapshot.lockScope,
                    workerId: opts.workerId,
                  },
                };
                return {
                  record,
                  recordPath: await writeTransitionRecord(opts.recordsRoot, record),
                };
              })()
            : await runCloudflarePagesStaticDeploy({
                workspaceRoot: opts.workspaceRoot,
                deployment: snapshot.deployment,
                artifact: snapshot.action.publishInput.artifact,
                recordsRoot: opts.recordsRoot,
                operationKind: snapshot.operationKind,
                admittedContext: snapshot.admittedContext,
                ...(snapshot.action.parentRunId
                  ? { parentRunId: snapshot.action.parentRunId }
                  : {}),
                ...(snapshot.action.releaseLineageId
                  ? { releaseLineageId: snapshot.action.releaseLineageId }
                  : {}),
                ...(snapshot.action.artifactLineageId
                  ? { artifactLineageId: snapshot.action.artifactLineageId }
                  : {}),
                ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
                ...(snapshot.action.publishMode
                  ? { publishMode: snapshot.action.publishMode }
                  : {}),
                ...(snapshot.action.effectiveRunTarget
                  ? { effectiveRunTarget: snapshot.action.effectiveRunTarget }
                  : {}),
                ...(snapshot.action.previewIdentitySelector
                  ? { previewIdentitySelector: snapshot.action.previewIdentitySelector }
                  : {}),
                authority: {
                  kind: "control-plane-worker",
                  submissionId: snapshot.submissionId,
                  submissionPath: opts.submissionRef,
                  workerId: opts.workerId,
                  lockScope: snapshot.lockScope,
                  executionSnapshotPath: opts.executionSnapshotPath,
                },
                ...(snapshot.smokeConnectOverride
                  ? { smokeConnectOverride: snapshot.smokeConnectOverride }
                  : {}),
              });
      await writeBackendDeployRecordDoc(
        opts.backend,
        sanitizedBackendRecord(result.record),
        result.recordPath,
      );
      await removeMirrorFile(result.recordPath);
      await persistCloudflareBackendStatus({
        backend: opts.backend,
        submissionPath: opts.submissionPath,
        submissionRef: opts.submissionRef,
        executionSnapshotRef: opts.executionSnapshotRef,
        submission: {
          ...running,
          lifecycleState: "finished",
          completedAt: new Date().toISOString(),
          deployRunId: result.record.deployRunId,
          resultRecordPath: result.recordPath,
          finalOutcome: result.record.finalOutcome,
        } as any,
      });
    } catch (error) {
      if (!(error as any)?.record || !(error as any)?.recordPath) throw error;
      await writeBackendDeployRecordDoc(
        opts.backend,
        sanitizedBackendRecord((error as any).record),
        (error as any).recordPath,
      );
      await removeMirrorFile((error as any).recordPath);
      await persistCloudflareBackendStatus({
        backend: opts.backend,
        submissionPath: opts.submissionPath,
        submissionRef: opts.submissionRef,
        executionSnapshotRef: opts.executionSnapshotRef,
        submission: {
          ...running,
          lifecycleState: "finished",
          completedAt: new Date().toISOString(),
          deployRunId: (error as any).record.deployRunId,
          resultRecordPath: (error as any).recordPath,
          finalOutcome: (error as any).record.finalOutcome,
        } as any,
      });
    }
  } finally {
    await lock.release();
  }
}
