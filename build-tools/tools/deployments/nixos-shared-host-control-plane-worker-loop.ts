#!/usr/bin/env zx-wrapper
import {
  claimBackendQueuedSubmission,
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  startBackendSubmissionClaimLease,
} from "./nixos-shared-host-control-plane-backend";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSubmission,
  removeMirrorFile,
} from "./nixos-shared-host-control-plane-backend-materialize";
import { persistMaterializedControlPlaneFilesIfCurrent } from "./nixos-shared-host-control-plane-worker-authority";
import {
  dispatchProviderControlPlaneSubmission,
  executeCloudflarePagesBackendSubmission,
} from "./nixos-shared-host-control-plane-worker-dispatch";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-submit-helpers";
import { reconcileNixosSharedHostRecoveredSubmission } from "./nixos-shared-host-recovery";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract";
import { materializeSnapshotArtifacts } from "./control-plane-artifact-materialize";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import { acquireBackendNixosSharedHostLocks } from "./nixos-shared-host-control-plane-worker-locks";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";
import type { ReviewedSourceCredentialFiles } from "./nixos-shared-host-reviewed-source-git";
export { startNixosSharedHostControlPlaneWorkerLoop } from "./nixos-shared-host-control-plane-worker-runtime";

export async function runNixosSharedHostControlPlaneWorkerOnce(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl: string;
  workerId: string;
  objectStore?: ControlPlaneArtifactStore;
  credentialDirectory?: ControlPlaneCredentialDirectory;
  reviewedSourceCredentials?: ReviewedSourceCredentialFiles;
  abortSignal?: AbortSignal;
  onClaimed?: (claimed: Awaited<ReturnType<typeof claimBackendQueuedSubmission>>) => Promise<void>;
}) {
  const backend = {
    recordsRoot: opts.recordsRoot,
    databaseUrl: opts.backendDatabaseUrl,
  };
  const claimed = await claimBackendQueuedSubmission(backend, opts.workerId);
  if (!claimed) return false;
  const claimLease = startBackendSubmissionClaimLease({
    backend,
    submissionId: claimed.submissionId,
    workerId: opts.workerId,
    claimToken: claimed.claimToken,
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
  });
  await opts.onClaimed?.(claimed);
  if (opts.abortSignal?.aborted) return true;
  let materialized: Awaited<ReturnType<typeof materializeBackendControlPlaneFiles>> | undefined;
  let materializedArtifactsRoot: string | undefined;
  let shouldPersistMaterialized = false;
  try {
    materialized = await materializeBackendControlPlaneFiles(backend, claimed.submissionId);
    const submission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
      materialized.submissionPath,
    );
    let snapshot = await readControlPlaneJson<any>(materialized.executionSnapshotPath);
    materializedArtifactsRoot = `${materialized.executionSnapshotPath}.artifacts`;
    snapshot = await materializeSnapshotArtifacts({
      snapshot,
      store: opts.objectStore,
      outputRoot: materializedArtifactsRoot,
      executionSnapshotPath: materialized.executionSnapshotPath,
    });
    shouldPersistMaterialized = true;
    if (snapshot?.deployment?.provider === "cloudflare-pages") {
      if (["running", "cancelling"].includes(claimed.lifecycleState)) {
        await reconcileNixosSharedHostRecoveredSubmission({
          submissionPath: materialized.submissionPath,
          recordsRoot: opts.recordsRoot,
          backend,
        });
        await claimLease.assertCurrentAuthority();
        await persistMaterializedSubmission({ backend, ...materialized });
        return true;
      }
      await executeCloudflarePagesBackendSubmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        backend,
        submissionPath: materialized.submissionPath,
        submissionRef: materialized.submissionRef,
        executionSnapshotPath: materialized.executionSnapshotPath,
        executionSnapshotRef: materialized.executionSnapshotRef,
        workerId: opts.workerId,
        ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
        assertCurrentAuthority: async () => await claimLease.assertCurrentAuthority(),
      });
      return true;
    }
    if (
      await dispatchProviderControlPlaneSubmission(String(snapshot?.deployment?.provider || ""), {
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        backend,
        submissionPath: materialized.submissionPath,
        submissionRef: materialized.submissionRef,
        executionSnapshotPath: materialized.executionSnapshotPath,
        executionSnapshotRef: materialized.executionSnapshotRef,
        workerId: opts.workerId,
        ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
        assertCurrentAuthority: async () => await claimLease.assertCurrentAuthority(),
      })
    ) {
      return true;
    }
    if (["running", "cancelling"].includes(claimed.lifecycleState)) {
      await reconcileNixosSharedHostRecoveredSubmission({
        submissionPath: materialized.submissionPath,
        recordsRoot: opts.recordsRoot,
        backend,
      });
      await claimLease.assertCurrentAuthority();
      await persistMaterializedSubmission({
        backend,
        submissionPath: materialized.submissionPath,
        submissionRef: materialized.submissionRef,
        executionSnapshotRef: materialized.executionSnapshotRef,
      });
      return true;
    }
    await executeSubmittedNixosSharedHostControlPlaneRun({
      submission,
      submissionPath: materialized.submissionPath,
      executionSnapshotPath: materialized.executionSnapshotPath,
      recordSubmissionPath: materialized.submissionRef,
      recordExecutionSnapshotPath: materialized.executionSnapshotRef,
      snapshot,
      workspaceRoot: opts.workspaceRoot,
      deployRunId: submission.deployRunId || `deploy-${claimed.submissionId}`,
      recordsRoot: opts.recordsRoot,
      backendDatabaseUrl: opts.backendDatabaseUrl,
      operationKind: snapshot.operationKind,
      deployment: snapshot.deployment,
      persistSubmission: async (updatedSubmission) =>
        await writeBackendSubmissionDoc(
          backend,
          {
            ...updatedSubmission,
            executionSnapshotPath: materialized.executionSnapshotRef,
          },
          {
            submissionPath: materialized.submissionRef,
            executionSnapshotPath: materialized.executionSnapshotRef,
          },
        ),
      persistRecord: async (record, recordPath) => {
        await writeBackendDeployRecordDoc(backend, record, recordPath, {
          expectedCurrentRunId: snapshot.expectedCurrentRunId,
        });
        await removeMirrorFile(recordPath);
      },
      assertCurrentAuthority: async () => await claimLease.assertCurrentAuthority(),
      recoverSubmission: async (args) =>
        await reconcileNixosSharedHostRecoveredSubmission({
          ...args,
          backend,
        }),
      acquireLocks: async (args) =>
        await acquireBackendNixosSharedHostLocks({
          backend,
          deployment: args.deployment,
          ...(args.shouldAbort ? { shouldAbort: args.shouldAbort } : {}),
        }),
      ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
      ...(opts.reviewedSourceCredentials
        ? { reviewedSourceCredentials: opts.reviewedSourceCredentials }
        : {}),
    });
  } finally {
    try {
      if (materialized && shouldPersistMaterialized) {
        await persistMaterializedControlPlaneFilesIfCurrent({
          backend,
          materialized,
          assertCurrentAuthority: async () => await claimLease.assertCurrentAuthority(),
        });
      }
    } finally {
      await claimLease.stop();
      await materialized?.cleanup();
      await removeMirrorFile(materializedArtifactsRoot);
    }
  }
  return true;
}
