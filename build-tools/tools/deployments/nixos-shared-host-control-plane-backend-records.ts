#!/usr/bin/env zx-wrapper
import {
  decodeBackendJson,
  queryBackend,
  readJson,
} from "./nixos-shared-host-control-plane-backend-db.ts";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db.ts";

type DeployRecordDoc = {
  deployRunId: string;
  controlPlane?: { submissionId?: string };
};

export async function syncBackendDeployRecord(
  backend: NixosSharedHostControlPlaneBackendTarget,
  recordPath: string,
) {
  const doc = await readJson<DeployRecordDoc>(recordPath);
  const submissionId = doc.controlPlane?.submissionId;
  if (!doc.deployRunId || !submissionId) {
    throw new Error(
      `shared deploy record is missing deployRunId or controlPlane.submissionId: ${recordPath}`,
    );
  }
  await queryBackend(
    backend,
    `INSERT INTO deploy_records (
      deploy_run_id, submission_id, record_path, document_json, updated_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    ON CONFLICT(deploy_run_id) DO UPDATE SET
      submission_id = EXCLUDED.submission_id,
      record_path = EXCLUDED.record_path,
      document_json = EXCLUDED.document_json,
      updated_at = EXCLUDED.updated_at`,
    [doc.deployRunId, submissionId, recordPath, JSON.stringify(doc), new Date().toISOString()],
  );
  return doc;
}

async function readRecordRow(
  backend: NixosSharedHostControlPlaneBackendTarget,
  whereSql: string,
  param: string,
) {
  return (
    await queryBackend<{ record_path?: string; document_json?: unknown }>(
      backend,
      `SELECT record_path, document_json FROM deploy_records WHERE ${whereSql}`,
      [param],
    )
  ).rows[0];
}

export async function readBackendDeployRecordEnvelopeByDeployRunId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deployRunId: string,
) {
  const row = await readRecordRow(backend, "deploy_run_id = $1", deployRunId);
  return row?.record_path && row.document_json
    ? {
        recordPath: row.record_path,
        record: decodeBackendJson(row.document_json),
      }
    : null;
}

export async function readBackendDeployRecordEnvelopeBySubmissionId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  const row = await readRecordRow(backend, "submission_id = $1", submissionId);
  return row?.record_path && row.document_json
    ? {
        recordPath: row.record_path,
        record: decodeBackendJson(row.document_json),
      }
    : null;
}
