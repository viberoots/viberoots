#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
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

export async function writeBackendDeployRecordDoc(
  backend: NixosSharedHostControlPlaneBackendTarget,
  doc: DeployRecordDoc,
  recordPath: string,
) {
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

export async function syncBackendDeployRecord(
  backend: NixosSharedHostControlPlaneBackendTarget,
  recordPath: string,
) {
  const doc = await readJson<DeployRecordDoc>(recordPath);
  return await writeBackendDeployRecordDoc(backend, doc, recordPath);
}

export async function syncBackendDeployRecordsFromRunMirrors(
  backend: NixosSharedHostControlPlaneBackendTarget,
) {
  const runsDir = path.join(path.resolve(backend.recordsRoot), "runs");
  let names: string[] = [];
  try {
    names = (await fsp.readdir(runsDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const name of names) {
    await syncBackendDeployRecord(backend, path.join(runsDir, name));
  }
}

async function readRecordRow(
  backend: NixosSharedHostControlPlaneBackendTarget,
  whereSql: string,
  param: string,
) {
  return (
    await queryBackend<{ record_path?: string; document_json?: unknown; updated_at?: string }>(
      backend,
      `SELECT record_path, document_json, updated_at FROM deploy_records WHERE ${whereSql}`,
      [param],
    )
  ).rows[0];
}

async function readLatestRecordRowByDeploymentId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    deploymentId: string;
    finalOutcome?: string;
    runClassification?: string;
    excludeDeployRunId?: string;
    requireReplaySnapshotPath?: boolean;
  },
) {
  const conditions = [`document_json->>'deploymentId' = $1`];
  const params: string[] = [opts.deploymentId];
  if (opts.finalOutcome) {
    params.push(opts.finalOutcome);
    conditions.push(`document_json->>'finalOutcome' = $${params.length}`);
  }
  if (opts.runClassification) {
    params.push(opts.runClassification);
    conditions.push(`document_json->>'runClassification' = $${params.length}`);
  }
  if (opts.excludeDeployRunId) {
    params.push(opts.excludeDeployRunId);
    conditions.push(`deploy_run_id <> $${params.length}`);
  }
  if (opts.requireReplaySnapshotPath) {
    conditions.push(`COALESCE(document_json->>'replaySnapshotPath', '') <> ''`);
  }
  return (
    await queryBackend<{ record_path?: string; document_json?: unknown; updated_at?: string }>(
      backend,
      `SELECT record_path, document_json
            , updated_at
       FROM deploy_records
       WHERE ${conditions.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT 1`,
      params,
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
        updatedAt: row.updated_at || "",
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
        updatedAt: row.updated_at || "",
        record: decodeBackendJson(row.document_json),
      }
    : null;
}

export async function readBackendDeployRecordByDeployRunId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deployRunId: string,
) {
  return (await readBackendDeployRecordEnvelopeByDeployRunId(backend, deployRunId))?.record || null;
}

export async function readBackendDeployRecordBySubmissionId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  submissionId: string,
) {
  return (
    (await readBackendDeployRecordEnvelopeBySubmissionId(backend, submissionId))?.record || null
  );
}

export async function readBackendLatestDeployRecordEnvelopeByDeploymentId(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    deploymentId: string;
    finalOutcome?: string;
    runClassification?: string;
    excludeDeployRunId?: string;
    requireReplaySnapshotPath?: boolean;
  },
) {
  const row = await readLatestRecordRowByDeploymentId(backend, opts);
  return row?.record_path && row.document_json
    ? {
        recordPath: row.record_path,
        updatedAt: row.updated_at || "",
        record: decodeBackendJson(row.document_json),
      }
    : null;
}
