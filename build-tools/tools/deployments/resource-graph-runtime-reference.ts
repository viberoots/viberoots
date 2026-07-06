#!/usr/bin/env zx-wrapper
import type { RuntimeSourceRecord } from "./resource-graph-types";

export function validateEvidenceReference(
  value: unknown,
  record: RuntimeSourceRecord,
  schemaVersion: string,
  label: string,
): string[] | null {
  if (!value || typeof value !== "object") return null;
  const evidence = value as Record<string, unknown>;
  if (evidence.schemaVersion !== schemaVersion) return null;
  const checkedAt = Date.parse(String(evidence.checkedAt || ""));
  const maxAgeMinutes = Number(record.validation?.maxAgeMinutes || 60);
  const sourceSnapshot = evidence.sourceSnapshot as Record<string, unknown> | undefined;
  const submissionId = String(sourceSnapshot?.submissionId || "");
  const executionSnapshotPath = String(sourceSnapshot?.executionSnapshotPath || "");
  const expectedPrefix = `evidence://control-plane/cloudflare-pages/snapshots/${encodeURIComponent(
    submissionId,
  )}/`;
  const evidenceRef = String(evidence.evidenceRef || "").trim();
  return [
    ...(evidenceRef ? [] : [`${label} evidenceRef is required`]),
    ...(submissionId ? [] : [`${label} source snapshot submissionId is required`]),
    ...(executionSnapshotPath
      ? []
      : [`${label} source snapshot executionSnapshotPath is required`]),
    ...(submissionId && evidenceRef.startsWith(expectedPrefix)
      ? []
      : [`${label} evidenceRef does not match source snapshot`]),
    ...(Number.isFinite(checkedAt) ? [] : [`${label} checkedAt is missing or invalid`]),
    ...(Number.isFinite(checkedAt) && Date.now() - checkedAt > maxAgeMinutes * 60_000
      ? [`${label} evidence is stale`]
      : []),
  ];
}

export function validateReadinessReference(value: unknown, record: RuntimeSourceRecord) {
  const errors = validateEvidenceReference(
    value,
    record,
    "control-plane-readiness-reference@1",
    "readiness",
  );
  if (!errors) return null;
  const evidence = value as Record<string, unknown>;
  return [
    ...errors,
    ...(String(evidence.operation || "") === String(record.validation?.operation || "cutover")
      ? []
      : ["readiness operation does not match"]),
  ];
}
