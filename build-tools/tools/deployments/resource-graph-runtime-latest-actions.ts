#!/usr/bin/env zx-wrapper
import { decodeBackendJson } from "./nixos-shared-host-control-plane-backend-db";

type JsonRow = Record<string, unknown>;

export function latestRuntimeActions(rows: JsonRow[]) {
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
  return [...latest.values()].sort((left, right) =>
    `${left.submissionId}:${left.submittedAt}:${left.actionId}`.localeCompare(
      `${right.submissionId}:${right.submittedAt}:${right.actionId}`,
    ),
  );
}
