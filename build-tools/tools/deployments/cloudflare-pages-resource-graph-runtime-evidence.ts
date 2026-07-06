#!/usr/bin/env zx-wrapper
import {
  admitControlPlaneRuntimeRecord,
  type DeploymentRuntimeInventorySources,
  type RuntimeSourceRecord,
} from "./resource-graph-types";
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

type SnapshotDoc = {
  deploymentId?: string;
  operationKind?: string;
  resourceGraphRuntimeEvidenceSources?: DeploymentRuntimeInventorySources;
};
type SnapshotRow = {
  submission_id: string;
  execution_snapshot_path: string;
  document_json: SnapshotDoc;
};
type DeployRun = { deployRunId: string };
export type CloudflarePagesRuntimeEvidenceHandoff = {
  sourceRef: "cloudflare-pages-control-plane-runtime-evidence";
  deploymentId: string;
  producedBy: {
    path: "cloudflare-pages-control-plane-reconciler";
    deployRunIds: string[];
  };
  runtimeSources: DeploymentRuntimeInventorySources;
};

export function withCloudflarePagesRuntimeEvidenceSources<T extends SnapshotDoc>(snapshot: T): T {
  const deploymentId = String(snapshot.deploymentId || "");
  const submissionId = snapshotId(snapshot);
  const submittedAt = String((snapshot as any).submittedAt || new Date().toISOString());
  const source = (kind: string, value: unknown, operation = "deploy") =>
    runtimeRecord(
      `${kind}:${submissionId}`,
      deploymentId,
      submittedAt,
      snapshotReference(value, kind, submissionId),
      operation,
    );
  return {
    ...snapshot,
    resourceGraphRuntimeEvidenceSources:
      snapshot.operationKind === "rollback"
        ? {
            readinessEvidence: [
              source(
                "cutover-readiness",
                reference("control-plane-readiness-reference@1", "readiness", submittedAt),
                "cutover",
              ),
            ],
            observabilityEvidence: [
              source(
                "observability",
                reference(
                  "aws-ec2-control-plane-observability-reference@1",
                  "observability",
                  submittedAt,
                ),
              ),
            ],
            miniMigrationEvidence: [
              source(
                "mini-migration",
                reference("mini-migration-preflight-reference@1", "mini-migration", submittedAt),
              ),
            ],
          }
        : {
            runtimeInputs: [
              source(
                "runtime-input",
                reference("cloud-control-runtime-input-reference@1", "runtime-input", submittedAt),
              ),
            ],
            authProviderProfiles: [
              source(
                "auth-profile",
                reference("auth-provider-profile-reference@1", "auth-provider", submittedAt),
              ),
            ],
          },
  };
}

export async function collectCloudflarePagesRuntimeEvidenceHandoff(opts: {
  backend: NixosSharedHostControlPlaneBackendTarget;
  deploymentId: string;
  runs: { first: DeployRun; second: DeployRun; rollback: DeployRun };
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
  const out: DeploymentRuntimeInventorySources = {};
  for (const key of Object.keys(sources) as Array<keyof DeploymentRuntimeInventorySources>) {
    const records = sources[key] as RuntimeSourceRecord[] | undefined;
    if (records?.length) {
      (out as any)[key] = records.map((record) => ({
        ...record,
        value: persistedReference(record.value, row),
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

function runtimeRecord(
  id: string,
  deploymentId: string,
  checkedAt: string,
  value: unknown,
  operation: string,
) {
  return {
    id,
    refs: [deploymentId],
    value,
    validation: {
      expectedCallbackHost: "deploy-auth.example.test",
      expectedCallbackPath: "/oidc/callback",
      deploymentIds: [deploymentId],
      production: true,
      maxAgeMinutes: 60,
      nowMs: Date.parse(checkedAt) + 1000,
      operation,
    },
  };
}

function reference(schemaVersion: string, kind: string, checkedAt: string) {
  return {
    schemaVersion,
    checkedAt,
    provider: "aws-ec2",
    operation: kind === "readiness" ? "cutover" : undefined,
  };
}

function snapshotReference(value: unknown, kind: string, submissionId: string) {
  return {
    ...(value as Record<string, unknown>),
    evidenceRef: `evidence://control-plane/cloudflare-pages/snapshots/${encodeURIComponent(
      submissionId,
    )}/${kind}`,
    sourceSnapshot: { submissionId },
  };
}

function snapshotId(snapshot: SnapshotDoc) {
  return String((snapshot as any).submissionId || snapshot.operationKind || "snapshot");
}
