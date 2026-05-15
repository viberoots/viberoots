#!/usr/bin/env zx-wrapper
import {
  decodeBackendJson,
  queryBackend,
  readJson,
  withBackendClient,
} from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";
import { writeCurrentStageStateForDeployRecord } from "./deployment-current-stage-state";
import { writeBackendStageStateAuditEvents } from "./deployment-stage-state-audit";
import { writeStageStateBackupFiles } from "./deployment-stage-state-backup";

type DeployRecordDoc = {
  deployRunId: string;
  controlPlane?: { submissionId?: string };
};

export async function writeBackendDeployRecordDoc(
  backend: NixosSharedHostControlPlaneBackendTarget,
  doc: DeployRecordDoc,
  recordPath: string,
  opts: { expectedCurrentRunId?: string | null } = {},
) {
  const submissionId = doc.controlPlane?.submissionId;
  if (!doc.deployRunId || !submissionId) {
    throw new Error(
      `shared deploy record is missing deployRunId or controlPlane.submissionId: ${recordPath}`,
    );
  }
  const updatedAt = new Date().toISOString();
  await withBackendClient(backend, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO deploy_records (
          deploy_run_id, submission_id, record_path, document_json, updated_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT(deploy_run_id) DO UPDATE SET
          submission_id = EXCLUDED.submission_id,
          record_path = EXCLUDED.record_path,
          document_json = EXCLUDED.document_json,
          updated_at = EXCLUDED.updated_at`,
        [doc.deployRunId, submissionId, recordPath, JSON.stringify(doc), updatedAt],
      );
      const state = await writeCurrentStageStateForDeployRecord({
        client,
        record: doc as any,
        updatedAt,
        ...(opts.expectedCurrentRunId === undefined
          ? {}
          : { enforceCompareAndSwap: true, expectedCurrentRunId: opts.expectedCurrentRunId }),
      });
      if (state) {
        await writeBackendStageStateAuditEvents({ client, state });
        await writeStageStateBackupFiles({ recordsRoot: backend.recordsRoot, state });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return doc;
}

export async function syncBackendDeployRecord(
  backend: NixosSharedHostControlPlaneBackendTarget,
  recordPath: string,
) {
  const doc = await readJson<DeployRecordDoc>(recordPath);
  return await writeBackendDeployRecordDoc(backend, doc, recordPath);
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

export async function readBackendLatestCloudflarePagesPreviewRecordEnvelope(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: {
    deploymentId: string;
    sourceRunId: string;
  },
) {
  const row = (
    await queryBackend<{ record_path?: string; document_json?: unknown; updated_at?: string }>(
      backend,
      `SELECT record_path, document_json, updated_at
         FROM deploy_records
        WHERE document_json->>'provider' = 'cloudflare-pages'
          AND document_json->>'deploymentId' = $1
          AND document_json->>'publishMode' = 'preview'
          AND document_json->>'operationKind' <> 'preview_cleanup'
          AND document_json->'previewIdentitySelector'->>'kind' = 'source_run'
          AND document_json->'previewIdentitySelector'->>'sourceRunId' = $2
        ORDER BY updated_at DESC
        LIMIT 1`,
      [opts.deploymentId, opts.sourceRunId],
    )
  ).rows[0];
  return row?.record_path && row.document_json
    ? {
        recordPath: row.record_path,
        updatedAt: row.updated_at || "",
        record: decodeBackendJson(row.document_json),
      }
    : null;
}
