#!/usr/bin/env zx-wrapper
import {
  decodeBackendJson,
  queryBackend,
  readJson,
} from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";
import { writeBackendSubmissionAuditEvents } from "./deployment-stage-state-audit";

type SubmissionDoc = {
  submissionId: string;
  deployRunId?: string;
  executionSnapshotPath: string;
  lockScope: string;
  lifecycleState: string;
  completedAt?: string;
};

type SnapshotDoc = { submissionId: string };

function keepsQueueOwnershipActive(lifecycleState: string) {
  return ["queued", "waiting_for_lock", "running", "cancelling"].includes(lifecycleState);
}

async function markQueueDone(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  await queryBackend(
    backend,
    `UPDATE queue
     SET completed_at = $1,
         claimed_by = NULL,
         claim_token = NULL,
         claim_expires_at = NULL
     WHERE submission_id = $2`,
    [new Date().toISOString(), submissionId],
  );
}

export async function writeBackendSubmissionDoc(
  backend: NixosSharedHostControlPlaneBackendTarget,
  doc: SubmissionDoc,
  refs: {
    submissionPath: string;
    executionSnapshotPath: string;
  },
) {
  const now = new Date().toISOString();
  await queryBackend(
    backend,
    `INSERT INTO submissions (
      submission_id, submission_path, execution_snapshot_path, lock_scope, lifecycle_state,
      deploy_run_id, completed_at, document_json, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    ON CONFLICT(submission_id) DO UPDATE SET
      submission_path = EXCLUDED.submission_path,
      execution_snapshot_path = EXCLUDED.execution_snapshot_path,
      lock_scope = EXCLUDED.lock_scope,
      lifecycle_state = EXCLUDED.lifecycle_state,
      deploy_run_id = EXCLUDED.deploy_run_id,
      completed_at = EXCLUDED.completed_at,
      document_json = EXCLUDED.document_json,
      updated_at = EXCLUDED.updated_at`,
    [
      doc.submissionId,
      refs.submissionPath,
      refs.executionSnapshotPath,
      doc.lockScope,
      doc.lifecycleState,
      doc.deployRunId || null,
      doc.completedAt || null,
      JSON.stringify(doc),
      now,
    ],
  );
  if (!keepsQueueOwnershipActive(doc.lifecycleState)) {
    await markQueueDone(backend, doc.submissionId);
  }
  await writeBackendSubmissionAuditEvents({
    client: {
      query: async <T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ) => await queryBackend<T>(backend, sql, params),
    },
    submission: doc,
  });
  return doc;
}

export async function syncBackendSubmission(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionPath: string,
) {
  const doc = await readJson<SubmissionDoc>(submissionPath);
  return await writeBackendSubmissionDoc(backend, doc, {
    submissionPath,
    executionSnapshotPath: doc.executionSnapshotPath,
  });
}

export async function writeBackendSnapshotDoc(
  backend: NixosSharedHostControlPlaneBackendTarget,
  doc: SnapshotDoc,
  executionSnapshotPath: string,
) {
  const now = new Date().toISOString();
  await queryBackend(
    backend,
    `INSERT INTO snapshots (
      submission_id, execution_snapshot_path, document_json, updated_at
    ) VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT(submission_id) DO UPDATE SET
      execution_snapshot_path = EXCLUDED.execution_snapshot_path,
      document_json = EXCLUDED.document_json,
      updated_at = EXCLUDED.updated_at`,
    [doc.submissionId, executionSnapshotPath, JSON.stringify(doc), now],
  );
  return doc;
}

export async function syncBackendSnapshot(
  backend: NixosSharedHostControlPlaneBackendTarget,
  executionSnapshotPath: string,
) {
  const doc = await readJson<SnapshotDoc>(executionSnapshotPath);
  return await writeBackendSnapshotDoc(backend, doc, executionSnapshotPath);
}

export async function enqueueBackendSubmission(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
  submittedAt: string,
) {
  await queryBackend(
    backend,
    `INSERT INTO queue (
       submission_id, enqueued_at, claimed_by, claim_token, claim_expires_at, completed_at
     ) VALUES ($1, $2, NULL, NULL, NULL, NULL)
     ON CONFLICT(submission_id) DO UPDATE SET
       enqueued_at = EXCLUDED.enqueued_at,
       claimed_by = NULL,
       claim_token = NULL,
       claim_expires_at = NULL,
       completed_at = NULL`,
    [submissionId, submittedAt],
  );
}

export async function readBackendSubmissionBySubmissionId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  const row = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      "SELECT document_json FROM submissions WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  return row?.document_json ? decodeBackendJson(row.document_json) : null;
}

export async function readBackendSubmissionByDeployRunId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deployRunId: string,
) {
  const row = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      "SELECT document_json FROM submissions WHERE deploy_run_id = $1",
      [deployRunId],
    )
  ).rows[0];
  return row?.document_json ? decodeBackendJson(row.document_json) : null;
}

export async function readBackendSnapshotBySubmissionId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  const row = (
    await queryBackend<{ execution_snapshot_path?: string; document_json?: unknown }>(
      backend,
      "SELECT execution_snapshot_path, document_json FROM snapshots WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  return row?.execution_snapshot_path && row.document_json
    ? {
        executionSnapshotPath: row.execution_snapshot_path,
        snapshot: decodeBackendJson(row.document_json),
      }
    : null;
}

export async function readBackendSubmissionEnvelopeBySubmissionId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  const row = (
    await queryBackend<{ submission_path?: string; document_json?: unknown }>(
      backend,
      "SELECT submission_path, document_json FROM submissions WHERE submission_id = $1",
      [submissionId],
    )
  ).rows[0];
  return row?.submission_path && row.document_json
    ? {
        submissionPath: row.submission_path,
        submission: decodeBackendJson(row.document_json),
      }
    : null;
}

export async function readBackendSubmissionEnvelopeByDeployRunId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deployRunId: string,
) {
  const row = (
    await queryBackend<{ submission_path?: string; document_json?: unknown }>(
      backend,
      "SELECT submission_path, document_json FROM submissions WHERE deploy_run_id = $1",
      [deployRunId],
    )
  ).rows[0];
  return row?.submission_path && row.document_json
    ? {
        submissionPath: row.submission_path,
        submission: decodeBackendJson(row.document_json),
      }
    : null;
}
