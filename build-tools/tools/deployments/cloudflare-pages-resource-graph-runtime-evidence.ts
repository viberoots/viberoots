#!/usr/bin/env zx-wrapper
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
  type RuntimeSourceRecord,
} from "./resource-graph-types";
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import { proofWithSnapshotPath } from "./cloudflare-pages-resource-graph-runtime-reference";
import type { RuntimeEvidenceDurableRecord } from "./resource-graph-runtime-reference";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

export { withCloudflarePagesRuntimeEvidenceSources } from "./cloudflare-pages-resource-graph-runtime-snapshot";

type RuntimeEvidenceSnapshotDoc = {
  deploymentId?: string;
  operationKind?: string;
  resourceGraphRuntimeEvidenceSources?: DeploymentRuntimeInventorySources;
  resourceGraphRuntimeEvidenceRecords?: RuntimeEvidenceDurableRecord[];
};
type SnapshotRow = {
  submission_id: string;
  execution_snapshot_path: string;
  document_json: RuntimeEvidenceSnapshotDoc;
};
type RuntimeEvidenceRunSet = {
  first: { deployRunId: string };
  second: { deployRunId: string };
  rollback: { deployRunId: string };
};
export type CloudflarePagesRuntimeEvidenceHandoff = {
  sourceRef: "cloudflare-pages-control-plane-runtime-evidence";
  deploymentId: string;
  producedBy: {
    path: "cloudflare-pages-control-plane-reconciler";
    deployRunIds: string[];
  };
  runtimeSources: DeploymentRuntimeInventorySources;
};

export async function collectCloudflarePagesRuntimeEvidenceHandoff(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deploymentId: string;
  runs: RuntimeEvidenceRunSet;
}): Promise<CloudflarePagesRuntimeEvidenceHandoff> {
  const rows = await queryBackend<SnapshotRow>(
    opts.backend,
    "SELECT submission_id, execution_snapshot_path, document_json FROM snapshots ORDER BY submission_id",
  );
  rows.rows.forEach(assertSnapshotRow);
  const runtimeSources = mergeSources(
    rows.rows
      .filter((row) => row.document_json.deploymentId === opts.deploymentId)
      .map((row) => sourcesFromPersistedSnapshot(row)),
  );
  return {
    sourceRef: "cloudflare-pages-control-plane-runtime-evidence",
    deploymentId: opts.deploymentId,
    producedBy: {
      path: "cloudflare-pages-control-plane-reconciler",
      deployRunIds: [
        opts.runs.first.deployRunId,
        opts.runs.second.deployRunId,
        opts.runs.rollback.deployRunId,
      ],
    },
    runtimeSources,
  };
}

function mergeSources(sources: DeploymentRuntimeInventorySources[]) {
  const merged: DeploymentRuntimeInventorySources = {};
  for (const source of sources) {
    for (const key of Object.keys(source) as Array<keyof DeploymentRuntimeInventorySources>) {
      const records = source[key] as RuntimeSourceRecord[] | undefined;
      if (records?.length && !merged[key]?.length) {
        (merged as any)[key] = records.map((record) => admitControlPlaneRuntimeRecord(record));
      }
    }
  }
  return merged;
}

function assertSnapshotRow(row: SnapshotRow) {
  if (!row.execution_snapshot_path || !row.submission_id) {
    throw new Error("cloudflare pages runtime evidence snapshot row is missing durable identity");
  }
}

function sourcesFromPersistedSnapshot(row: SnapshotRow) {
  const sources = row.document_json.resourceGraphRuntimeEvidenceSources || {};
  const durableRecords = persistedDurableRecords(row);
  const out: DeploymentRuntimeInventorySources = {};
  for (const key of Object.keys(sources) as Array<keyof DeploymentRuntimeInventorySources>) {
    const records = sources[key] as RuntimeSourceRecord[] | undefined;
    if (records?.length) {
      (out as any)[key] = records.map((record) => ({
        ...record,
        value: persistedReference(record.value, row),
        validation: { ...record.validation, runtimeEvidenceRecords: durableRecords },
      }));
    }
  }
  return out;
}

function persistedReference(value: unknown, row: SnapshotRow) {
  if (!value || typeof value !== "object") return value;
  const reference = value as Record<string, unknown>;
  const sourceSnapshot = reference.sourceSnapshot as Record<string, unknown> | undefined;
  if (sourceSnapshot?.submissionId !== row.submission_id) {
    throw new Error(`runtime evidence source does not match snapshot ${row.submission_id}`);
  }
  return {
    ...reference,
    sourceSnapshot: {
      ...sourceSnapshot,
      executionSnapshotPath: row.execution_snapshot_path,
    },
  };
}

function persistedDurableRecords(row: SnapshotRow) {
  return (row.document_json.resourceGraphRuntimeEvidenceRecords || []).map((record) =>
    proofWithSnapshotPath(record, row.execution_snapshot_path),
  );
}
