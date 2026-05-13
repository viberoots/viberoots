#!/usr/bin/env zx-wrapper
import type { DeploymentStageStateAuditEvent } from "./deployment-stage-state-audit";

export function formatDeploymentStageStateAuditEventText(
  event: DeploymentStageStateAuditEvent,
): string {
  return [
    `audit: ${event.eventType}`,
    `occurredAt: ${event.occurredAt}`,
    `deployment: ${event.deploymentId} ${event.environmentStage}`,
    `deployRunId: ${event.deployRunId}`,
    `operationKind: ${event.operationKind}`,
    event.sourceRunId ? `sourceRunId: ${event.sourceRunId}` : undefined,
    `sourceRevision: ${event.sourceRevision}`,
    `artifact: ${event.artifactIdentity}`,
    event.actor ? `actor: ${event.actor}` : undefined,
    event.reason ? `reason: ${event.reason}` : undefined,
    event.finalOutcome ? `finalOutcome: ${event.finalOutcome}` : undefined,
    event.requiredChecks?.length ? `requiredChecks: ${event.requiredChecks.join(",")}` : undefined,
    event.requiredApprovals?.length
      ? `requiredApprovals: ${event.requiredApprovals.join(",")}`
      : undefined,
    `eventHash: ${event.eventHash}`,
    event.previousEventHash ? `previousEventHash: ${event.previousEventHash}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
