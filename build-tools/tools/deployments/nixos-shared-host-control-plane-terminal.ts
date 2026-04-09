#!/usr/bin/env zx-wrapper
import { createNixosSharedHostControlPlaneSubmission } from "./nixos-shared-host-control-plane-submission.ts";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract.ts";

export function createWaitTerminalSubmission(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    terminationReason: "cancelled" | "superseded" | "no_longer_admitted" | "lock_timeout";
    dedupe: NixosSharedHostControlPlaneSubmission["dedupe"];
    requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
    authorization?: NixosSharedHostControlPlaneSubmission["authorization"];
    deployRunId?: string;
  },
): NixosSharedHostControlPlaneSubmission {
  return createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "admitted", reason: "shared_nonprod" },
    lifecycleState: opts.terminationReason === "cancelled" ? "cancelled" : "finished",
    completedAt: new Date().toISOString(),
    terminationReason: opts.terminationReason,
    dedupe: opts.dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
    ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
  });
}

export function createLockConflictSubmission(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  executionSnapshotPath: string,
  opts: {
    dedupe: NixosSharedHostControlPlaneSubmission["dedupe"];
    requestedBy?: NixosSharedHostControlPlaneSubmission["requestedBy"];
    authorization?: NixosSharedHostControlPlaneSubmission["authorization"];
    deployRunId?: string;
  },
): NixosSharedHostControlPlaneSubmission {
  return createNixosSharedHostControlPlaneSubmission(snapshot, executionSnapshotPath, {
    admission: { decision: "rejected", reason: "lock_conflict" },
    lifecycleState: "finished",
    completedAt: new Date().toISOString(),
    dedupe: opts.dedupe,
    requestedBy: opts.requestedBy,
    authorization: opts.authorization,
    rejectionCode: "lock_conflict",
    ...(snapshot.progressiveRollout ? { progressiveRollout: snapshot.progressiveRollout } : {}),
    ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
  });
}
