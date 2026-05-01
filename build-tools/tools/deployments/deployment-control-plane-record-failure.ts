#!/usr/bin/env zx-wrapper
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";

function nonEmpty(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function recordSelector(record: any): string | undefined {
  const deployRunId = nonEmpty(record?.deployRunId);
  if (deployRunId) return `deploy --record --deploy-run-id ${deployRunId} --text`;
  const submissionId = nonEmpty(
    record?.controlPlane?.submissionId || record?.authority?.submissionId,
  );
  return submissionId ? `deploy --record --submission-id ${submissionId} --text` : undefined;
}

export function controlPlaneRecordFailureMessage(record: any): string {
  const facts = [
    nonEmpty(record?.finalOutcome) ? `outcome ${record.finalOutcome}` : "",
    nonEmpty(record?.failedStep) ? `failed step ${record.failedStep}` : "",
    nonEmpty(record?.deployRunId) ? `deployRunId ${record.deployRunId}` : "",
    nonEmpty(record?.controlPlane?.submissionId || record?.authority?.submissionId)
      ? `submissionId ${record.controlPlane?.submissionId || record.authority?.submissionId}`
      : "",
    nonEmpty(record?.errorFingerprint) ? `errorFingerprint ${record.errorFingerprint}` : "",
  ].filter(Boolean);
  const diagnostic = nonEmpty(record?.error || record?.smokeError);
  const selector = recordSelector(record);
  return [
    `shared control-plane mutation failed: ${facts.join("; ") || "unknown outcome"}`,
    diagnostic ? `diagnostic: ${redactDeploymentAuthText(diagnostic)}` : "",
    selector ? `Inspect the finalized record with: ${selector}` : "",
  ]
    .filter(Boolean)
    .join(". ");
}
