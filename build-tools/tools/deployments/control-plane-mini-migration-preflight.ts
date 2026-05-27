#!/usr/bin/env zx-wrapper
import { queryBackend } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend-db";

const REQUIRED_TABLES = [
  "submissions",
  "queue",
  "control_plane_audit_events",
  "current_stage_state",
  "deploy_records",
  "idempotency",
] as const;

export type MiniCloudMigrationEvidence = {
  stateSync: { status: "passed"; checkedAt: string };
  restore: { status: "passed"; checkedAt: string; evidenceRef: string };
  rollback: { status: "passed"; checkedAt: string; evidenceRef: string };
  migratedRows: Partial<Record<(typeof REQUIRED_TABLES)[number], number>>;
};

function missingEvidenceFields(evidence: Partial<MiniCloudMigrationEvidence>) {
  const missing: string[] = [];
  for (const field of ["stateSync", "restore", "rollback"] as const) {
    if (evidence[field]?.status !== "passed") missing.push(`${field}.status`);
    if (!evidence[field]?.checkedAt) missing.push(`${field}.checkedAt`);
  }
  if (!evidence.restore?.evidenceRef) missing.push("restore.evidenceRef");
  if (!evidence.rollback?.evidenceRef) missing.push("rollback.evidenceRef");
  for (const table of REQUIRED_TABLES) {
    if (!Number.isInteger(evidence.migratedRows?.[table])) {
      missing.push(`migratedRows.${table}`);
    }
  }
  return missing;
}

export function validateMiniCloudMigrationEvidence(
  evidence: Partial<MiniCloudMigrationEvidence> | undefined,
) {
  if (!evidence) throw new Error("mini cloud migration evidence is required");
  const missing = missingEvidenceFields(evidence);
  if (missing.length > 0) {
    throw new Error(`mini cloud migration evidence is incomplete: ${missing.join(", ")}`);
  }
  return evidence as MiniCloudMigrationEvidence;
}

export async function assertMiniCloudMigrationPreflight(opts: {
  enabled: boolean;
  backend: NixosSharedHostControlPlaneBackendTarget;
  evidence?: Partial<MiniCloudMigrationEvidence>;
}) {
  if (!opts.enabled) return;
  const evidence = validateMiniCloudMigrationEvidence(opts.evidence);
  for (const table of REQUIRED_TABLES) {
    const row = (
      await queryBackend<{ count: string }>(
        opts.backend,
        `SELECT COUNT(*)::text AS count FROM ${table}`,
      )
    ).rows[0];
    const actual = Number(row?.count || 0);
    const expected = evidence.migratedRows[table] ?? 0;
    if (actual < expected) {
      throw new Error(
        `mini cloud migration preflight failed for ${table}: ${actual} < ${expected}`,
      );
    }
  }
}
