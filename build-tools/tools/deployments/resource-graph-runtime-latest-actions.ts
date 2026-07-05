#!/usr/bin/env zx-wrapper
import { decodeBackendJson } from "./nixos-shared-host-control-plane-backend-db";

type JsonRow = Record<string, unknown>;

export function latestRuntimeActions(rows: JsonRow[], submissions: JsonRow[] = []) {
  const latest = new Map<string, { submissionId: string; actionId: string; submittedAt: string }>();
  for (const row of rows) {
    const request = row.request_json ? decodeBackendJson<any>(row.request_json) : {};
    const entry = {
      submissionId: String(row.submission_id),
      actionId: String(row.action_id),
      submittedAt: String(request.submittedAt || ""),
    };
    const current = latest.get(entry.submissionId);
    if (
      !current ||
      `${entry.submittedAt}:${entry.actionId}` > `${current.submittedAt}:${current.actionId}`
    ) {
      latest.set(entry.submissionId, entry);
    }
  }
  for (const row of submissions) {
    const submissionId = String(row.submission_id || "");
    if (!submissionId || latest.has(submissionId)) continue;
    const doc = row.document_json ? decodeBackendJson<any>(row.document_json) : {};
    latest.set(submissionId, {
      submissionId,
      actionId: String(row.deploy_run_id || submissionId),
      submittedAt: submittedAt(doc.submittedAt || row.updated_at),
    });
  }
  return [...latest.values()].sort((left, right) =>
    `${left.submissionId}:${left.submittedAt}:${left.actionId}`.localeCompare(
      `${right.submissionId}:${right.submittedAt}:${right.actionId}`,
    ),
  );
}

function submittedAt(value: unknown): string {
  const raw = String(value || "");
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}
