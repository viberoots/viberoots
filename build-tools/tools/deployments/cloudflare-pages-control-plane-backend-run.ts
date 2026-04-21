#!/usr/bin/env zx-wrapper
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy.ts";
import type { CloudflarePagesControlPlaneSnapshot } from "./cloudflare-pages-control-plane-contract.ts";
import { createCloudflarePagesDeployRunId } from "./cloudflare-pages-records.ts";
import { resolveCloudflarePagesAdmittedSecretReferences } from "./cloudflare-pages-admission.ts";
import { revalidateControlPlaneAdmission } from "./deployment-control-plane-revalidation.ts";
import { lockWaitAbortReasonForSubmission } from "./deployment-control-plane-queue.ts";
import {
  acquireBackendControlPlaneLock,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend.ts";
import { removeMirrorFile } from "./nixos-shared-host-control-plane-backend-materialize.ts";
import {
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store.ts";
import {
  writeTransitionRecord,
  type CloudflarePagesTargetTransitionRecord,
} from "./cloudflare-pages-target-transition-records.ts";
import { sanitizedBackendRecord } from "./cloudflare-pages-control-plane-backend-records.ts";
// prettier-ignore
import { persistCloudflareBackendStatus, type CloudflareBackendSubmissionLike } from "./cloudflare-pages-control-plane-backend-status.ts";
import { executeCloudflarePagesBackendPreviewCleanup } from "./cloudflare-pages-control-plane-backend-preview-cleanup.ts";
import { withWorkerDeploymentVaultRuntime } from "./deployment-vault-runtime-worker.ts";
import type { DeploymentSecretContext } from "./deployment-secret-context.ts";

async function prepareWorkerAdmittedSnapshot(opts: {
  workspaceRoot: string;
  backend: NixosSharedHostControlPlaneBackendTarget;
  executionSnapshotPath: string;
  executionSnapshotRef: string;
  snapshot: CloudflarePagesControlPlaneSnapshot;
  secretContext?: DeploymentSecretContext;
}) {
  if (!opts.snapshot.admittedContext) return;
  await revalidateControlPlaneAdmission({
    workspaceRoot: opts.workspaceRoot,
    deployment: opts.snapshot.deployment,
    admittedContext: opts.snapshot.admittedContext,
  });
  opts.snapshot.admittedContext = {
    ...opts.snapshot.admittedContext,
    admittedSecretReferences: await resolveCloudflarePagesAdmittedSecretReferences({
      deployment: opts.snapshot.deployment,
      admittedContext: opts.snapshot.admittedContext,
      ...(opts.secretContext ? { secretContext: opts.secretContext } : {}),
    }),
  };
  await writeControlPlaneJson(opts.executionSnapshotPath, opts.snapshot);
  await writeBackendSnapshotDoc(opts.backend, opts.snapshot, opts.executionSnapshotRef);
}

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
    try {
      const result =
        snapshot.action?.kind === "preview_cleanup"
          ? await withWorkerDeploymentVaultRuntime(
              { workspaceRoot: opts.workspaceRoot, deployment: snapshot.deployment },
              async (runtime) => {
                await prepareWorkerAdmittedSnapshot({
                  workspaceRoot: opts.workspaceRoot,
                  backend: opts.backend,
                  executionSnapshotPath: opts.executionSnapshotPath,
                  executionSnapshotRef: opts.executionSnapshotRef,
                  snapshot,
                  ...(runtime.secretContext ? { secretContext: runtime.secretContext } : {}),
                });
                return await executeCloudflarePagesBackendPreviewCleanup({
                  recordsRoot: opts.recordsRoot,
                  workerId: opts.workerId,
                  snapshot,
                });
              },
            )
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
            : await withWorkerDeploymentVaultRuntime(
                { workspaceRoot: opts.workspaceRoot, deployment: snapshot.deployment },
                async (runtime) => {
                  await prepareWorkerAdmittedSnapshot({
                    workspaceRoot: opts.workspaceRoot,
                    backend: opts.backend,
                    executionSnapshotPath: opts.executionSnapshotPath,
                    executionSnapshotRef: opts.executionSnapshotRef,
                    snapshot,
                    ...(runtime.secretContext ? { secretContext: runtime.secretContext } : {}),
                  });
                  return await runCloudflarePagesStaticDeploy({
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
                },
              );
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
