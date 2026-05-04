#!/usr/bin/env zx-wrapper
import { progressiveRolloutIsActive } from "./nixos-shared-host-progressive-rollout";
import { decodeBackendJson, queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";
import type {
  NixosSharedHostControlPlaneSnapshot,
  NixosSharedHostControlPlaneSubmission,
} from "./nixos-shared-host-control-plane-contract";
import { writeBackendSubmissionDoc } from "./nixos-shared-host-control-plane-backend-state";

type SupersedableRow = {
  submission_path?: string;
  execution_snapshot_path?: string;
  submission_json?: unknown;
  snapshot_json?: unknown;
};

function autoSupersedableNormalDeploy(snapshot: NixosSharedHostControlPlaneSnapshot): boolean {
  return (
    snapshot.operationKind === "deploy" &&
    snapshot.action.kind === "deploy" &&
    snapshot.action.publishBehavior === "deploy"
  );
}

function submittedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function ensureNoActiveProgressiveRunInBackend(
  backend: NixosSharedHostControlPlaneBackendTarget,
  lockScope: string,
  submissionId: string,
) {
  const rows = await queryBackend<{ document_json?: unknown }>(
    backend,
    `SELECT document_json
     FROM submissions
     WHERE lock_scope = $1
       AND submission_id <> $2`,
    [lockScope, submissionId],
  );
  for (const row of rows.rows) {
    const submission = decodeBackendJson<NixosSharedHostControlPlaneSubmission>(row.document_json);
    if (progressiveRolloutIsActive(submission.progressiveRollout)) {
      throw Object.assign(new Error(`active progressive rollout already exists for ${lockScope}`), {
        code: "supersedence_blocked",
      });
    }
  }
}

async function supersedeOlderQueuedRunsInBackend(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  submission: NixosSharedHostControlPlaneSubmission;
  refs: {
    submissionPath: string;
    executionSnapshotPath: string;
  };
}) {
  if (!autoSupersedableNormalDeploy(opts.snapshot)) return;
  const rows = await queryBackend<SupersedableRow>(
    opts.backend,
    `SELECT s.submission_path,
            s.execution_snapshot_path,
            s.document_json AS submission_json,
            snap.document_json AS snapshot_json
     FROM submissions s
     JOIN snapshots snap ON snap.submission_id = s.submission_id
     WHERE s.submission_id <> $1
       AND s.lock_scope = $2
       AND s.lifecycle_state IN ('queued', 'waiting_for_lock')
       AND s.document_json->>'deploymentId' = $3`,
    [opts.submission.submissionId, opts.snapshot.lockScope, opts.snapshot.deploymentId],
  );
  const currentSubmittedAt = submittedAtMs(opts.snapshot.submittedAt);
  const completedAt = new Date().toISOString();
  for (const row of rows.rows) {
    if (
      !row.submission_path ||
      !row.execution_snapshot_path ||
      !row.submission_json ||
      !row.snapshot_json
    ) {
      continue;
    }
    const submission = decodeBackendJson<NixosSharedHostControlPlaneSubmission>(
      row.submission_json,
    );
    const snapshot = decodeBackendJson<NixosSharedHostControlPlaneSnapshot>(row.snapshot_json);
    if (!autoSupersedableNormalDeploy(snapshot)) continue;
    if (submittedAtMs(snapshot.submittedAt) > currentSubmittedAt) continue;
    await writeBackendSubmissionDoc(
      opts.backend,
      {
        ...submission,
        lifecycleState: "finished",
        terminationReason: "superseded",
        completedAt,
      },
      {
        submissionPath: row.submission_path,
        executionSnapshotPath: row.execution_snapshot_path,
      },
    );
  }
}

export async function queueBackendSubmissionForLock(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  snapshot: NixosSharedHostControlPlaneSnapshot;
  submission: NixosSharedHostControlPlaneSubmission;
  refs: {
    submissionPath: string;
    executionSnapshotPath: string;
  };
}) {
  await writeBackendSubmissionDoc(opts.backend, opts.submission, opts.refs);
  await supersedeOlderQueuedRunsInBackend(opts);
  const waiting = { ...opts.submission, lifecycleState: "waiting_for_lock" as const };
  await writeBackendSubmissionDoc(opts.backend, waiting, opts.refs);
  return waiting;
}
