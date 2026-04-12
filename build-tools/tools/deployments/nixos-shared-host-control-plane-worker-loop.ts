#!/usr/bin/env zx-wrapper
import {
  claimBackendQueuedSubmission,
  acquireBackendControlPlaneLock,
  startBackendSubmissionClaimLease,
  syncBackendDeployRecord,
  syncBackendSnapshot,
  syncBackendSubmission,
} from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import { executeSubmittedNixosSharedHostControlPlaneRun } from "./nixos-shared-host-control-plane-submit-helpers.ts";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store.ts";
import { reconcileNixosSharedHostRecoveredSubmission } from "./nixos-shared-host-recovery.ts";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components.ts";

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
  await syncBackendSnapshot(backend, claimed.executionSnapshotPath);
  const submission = await readControlPlaneJson<NixosSharedHostControlPlaneSubmission>(
    claimed.submissionPath,
  );
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    claimed.executionSnapshotPath,
  );
  try {
    if (["running", "cancelling"].includes(claimed.lifecycleState)) {
      await reconcileNixosSharedHostRecoveredSubmission({
        submissionPath: claimed.submissionPath,
        recordsRoot: opts.recordsRoot,
        backend,
      });
      await syncBackendSubmission(backend, claimed.submissionPath);
      return true;
    }
    await executeSubmittedNixosSharedHostControlPlaneRun({
      submission,
      submissionPath: claimed.submissionPath,
      executionSnapshotPath: claimed.executionSnapshotPath,
      snapshot,
      workspaceRoot: opts.workspaceRoot,
      deployRunId: submission.deployRunId || `deploy-${claimed.submissionId}`,
      recordsRoot: opts.recordsRoot,
      operationKind: snapshot.operationKind,
      deployment: snapshot.deployment,
      persistSubmission: async (submissionPath) =>
        await syncBackendSubmission(backend, submissionPath),
      persistRecord: async (recordPath) => await syncBackendDeployRecord(backend, recordPath),
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
    await syncBackendSubmission(backend, claimed.submissionPath);
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
