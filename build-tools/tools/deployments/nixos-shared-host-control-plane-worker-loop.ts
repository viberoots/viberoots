#!/usr/bin/env zx-wrapper
import {
  claimBackendQueuedSubmission,
  acquireBackendControlPlaneLock,
  writeBackendDeployRecordDoc,
  writeBackendSubmissionDoc,
  startBackendSubmissionClaimLease,
} from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import {
  materializeBackendControlPlaneFiles,
  persistMaterializedSnapshot,
  persistMaterializedSubmission,
  removeMirrorFile,
} from "./nixos-shared-host-control-plane-backend-materialize.ts";
import { executeCloudflarePagesBackendSubmission } from "./cloudflare-pages-control-plane-backend-run.ts";
import { executeKubernetesControlPlaneSubmission } from "./kubernetes-control-plane.ts";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-submit-helpers.ts";
import { reconcileNixosSharedHostRecoveredSubmission } from "./nixos-shared-host-recovery.ts";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import type { NixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-contract.ts";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components.ts";
import { executeS3StaticControlPlaneSubmission } from "./s3-static-control-plane.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireBackendNixosSharedHostLocks(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deployment: Parameters<typeof nixosSharedHostLockScopes>[0];
  shouldAbort?: () => Promise<"cancelled" | "superseded" | "no_longer_admitted" | null>;
}) {
  const releases: Array<() => Promise<void>> = [];
  let fencingToken: string | undefined;
  try {
    for (const lockScope of nixosSharedHostLockScopes(opts.deployment)) {
      const lock = await acquireBackendControlPlaneLock(opts.backend, lockScope, {
        ...(opts.shouldAbort ? { shouldAbort: opts.shouldAbort } : {}),
      });
      if (!fencingToken) fencingToken = lock.fencingToken;
      releases.push(lock.release);
    }
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return {
    fencingToken,
    release: async () => {
      for (const release of releases.reverse()) await release();
    },
  };
}

export async function runNixosSharedHostControlPlaneWorkerOnce(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl: string;
  workerId: string;
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
  });
  const materialized = await materializeBackendControlPlaneFiles(backend, claimed.submissionId);
  const submission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
    materialized.submissionPath,
  );
  const snapshot = await readControlPlaneJson<any>(materialized.executionSnapshotPath);
  try {
    if (snapshot?.deployment?.provider === "cloudflare-pages") {
      if (["running", "cancelling"].includes(claimed.lifecycleState)) {
        throw new Error(
          `cloudflare-pages backend recovery is not supported for ${claimed.submissionId}`,
        );
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
      });
      return true;
    }
    if (snapshot?.deployment?.provider === "s3-static") {
      await executeS3StaticControlPlaneSubmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        backend,
        submissionPath: materialized.submissionPath,
        submissionRef: materialized.submissionRef,
        executionSnapshotPath: materialized.executionSnapshotPath,
        executionSnapshotRef: materialized.executionSnapshotRef,
        workerId: opts.workerId,
      });
      return true;
    }
    if (snapshot?.deployment?.provider === "kubernetes") {
      await executeKubernetesControlPlaneSubmission({
        workspaceRoot: opts.workspaceRoot,
        recordsRoot: opts.recordsRoot,
        backend,
        submissionPath: materialized.submissionPath,
        submissionRef: materialized.submissionRef,
        executionSnapshotPath: materialized.executionSnapshotPath,
        executionSnapshotRef: materialized.executionSnapshotRef,
        workerId: opts.workerId,
      });
      return true;
    }
    if (["running", "cancelling"].includes(claimed.lifecycleState)) {
      await reconcileNixosSharedHostRecoveredSubmission({
        submissionPath: materialized.submissionPath,
        recordsRoot: opts.recordsRoot,
        backend,
      });
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
        await writeBackendDeployRecordDoc(backend, record, recordPath);
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
    });
  } finally {
    await claimLease.stop();
    await persistMaterializedSnapshot({
      backend,
      executionSnapshotPath: materialized.executionSnapshotPath,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    await persistMaterializedSubmission({
      backend,
      submissionPath: materialized.submissionPath,
      submissionRef: materialized.submissionRef,
      executionSnapshotRef: materialized.executionSnapshotRef,
    });
    await materialized.cleanup();
  }
  return true;
}

export function startNixosSharedHostControlPlaneWorkerLoop(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl: string;
  workerId?: string;
  pollMs?: number;
  onError?: (error: unknown) => void;
}) {
  let closed = false;
  let running = false;
  const pollMs = opts.pollMs ?? 100;
  const workerId = opts.workerId || `worker-${process.pid}`;
  const tick = async () => {
    if (closed || running) return;
    running = true;
    try {
      while (!closed) {
        try {
          if (
            !(await runNixosSharedHostControlPlaneWorkerOnce({
              workspaceRoot: opts.workspaceRoot,
              recordsRoot: opts.recordsRoot,
              backendDatabaseUrl: opts.backendDatabaseUrl,
              workerId,
            }))
          ) {
            break;
          }
        } catch (error) {
          opts.onError?.(error);
          break;
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  void tick();
  return {
    close: async () => {
      closed = true;
      clearInterval(timer);
      while (running) await sleep(25);
    },
  };
}
