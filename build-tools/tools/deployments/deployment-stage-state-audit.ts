#!/usr/bin/env zx-wrapper
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import { redactOperatorText } from "./deployment-control-plane-redaction";
import type { BackendQueryable } from "./nixos-shared-host-control-plane-backend-db";
import {
  decodeBackendJson,
  queryBackend,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state-types";

export const DEPLOYMENT_STAGE_STATE_AUDIT_SCHEMA = "deployment-stage-state-audit-event@1";

export type DeploymentStageStateAuditEvent = {
  schemaVersion: typeof DEPLOYMENT_STAGE_STATE_AUDIT_SCHEMA;
  eventId: string;
  auditSequence?: number;
  contentHash: string;
  eventHash: string;
  previousEventHash?: string;
  eventType:
    | "stage_state_updated"
    | "promotion_lineage_recorded"
    | "retry_lineage_recorded"
    | "rollback_lineage_recorded"
    | "cancellation_recorded"
    | "recovery_recorded";
  occurredAt: string;
  deploymentId: string;
  environmentStage: string;
  deployRunId: string;
  operationKind: string;
  sourceRunId?: string;
  parentRunId?: string;
  releaseLineageId?: string;
  artifactLineageId?: string;
  sourceRevision: string;
  artifactIdentity: string;
  targetIdentity: string;
  actor?: string;
  reason?: string;
  finalOutcome?: string;
  requiredChecks?: string[];
  requiredApprovals?: string[];
};

type DeploymentStageStateAuditEventDraft = Omit<
  DeploymentStageStateAuditEvent,
  "contentHash" | "eventHash" | "eventId" | "previousEventHash"
>;

function safeText(value: string): string {
  const visible = redactOperatorText(value);
  return visible?.redacted ? visible.summary : value;
}

function baseEvent(
  state: DeploymentCurrentStageState,
  eventType: DeploymentStageStateAuditEvent["eventType"],
): DeploymentStageStateAuditEventDraft {
  const requiredChecks = state.requiredChecks.map((check) => check.name).filter(Boolean);
  const requiredApprovals = state.approvalContext?.requiredApprovals || [];
  return {
    schemaVersion: DEPLOYMENT_STAGE_STATE_AUDIT_SCHEMA,
    eventType,
    occurredAt: state.updatedAt,
    deploymentId: safeText(state.deploymentId),
    environmentStage: safeText(state.environmentStage),
    deployRunId: safeText(state.currentRunId),
    operationKind: safeText(state.operationKind),
    ...(state.sourceRunId ? { sourceRunId: safeText(state.sourceRunId) } : {}),
    ...(state.parentRunId ? { parentRunId: safeText(state.parentRunId) } : {}),
    ...(state.releaseLineageId ? { releaseLineageId: safeText(state.releaseLineageId) } : {}),
    ...(state.artifactLineageId ? { artifactLineageId: safeText(state.artifactLineageId) } : {}),
    sourceRevision: safeText(state.sourceRevision),
    artifactIdentity: safeText(state.artifactIdentity),
    targetIdentity: safeText(state.providerTargetIdentity),
    ...(state.approvalContext?.requestedBy
      ? { actor: safeText(state.approvalContext.requestedBy) }
      : {}),
    reason: `${safeText(state.operationKind)} ${safeText(state.finalOutcome)}`,
    finalOutcome: safeText(state.finalOutcome),
    ...(requiredChecks.length > 0 ? { requiredChecks: requiredChecks.map(safeText) } : {}),
    ...(requiredApprovals.length > 0 ? { requiredApprovals: requiredApprovals.map(safeText) } : {}),
  };
}

function finalizeEvent(
  event: DeploymentStageStateAuditEventDraft,
  previousEventHash?: string,
): DeploymentStageStateAuditEvent {
  const contentHash = fingerprintValue(event);
  const eventHash = fingerprintValue({ contentHash, previousEventHash: previousEventHash || "" });
  return {
    ...event,
    contentHash,
    eventHash,
    eventId: eventHash,
    ...(previousEventHash ? { previousEventHash } : {}),
  };
}

export function stageStateAuditEventsFor(
  state: DeploymentCurrentStageState,
): DeploymentStageStateAuditEvent[] {
  const events = [baseEvent(state, "stage_state_updated")];
  if (state.operationKind === "promotion")
    events.push(baseEvent(state, "promotion_lineage_recorded"));
  if (state.operationKind === "retry") events.push(baseEvent(state, "retry_lineage_recorded"));
  if (state.operationKind === "rollback")
    events.push(baseEvent(state, "rollback_lineage_recorded"));
  return events.map((event) => finalizeEvent(event));
}

function submissionAuditEvent(doc: any): DeploymentStageStateAuditEventDraft | undefined {
  const eventType =
    doc.lifecycleState === "cancelled" || doc.cancellationSummary
      ? "cancellation_recorded"
      : doc.recovery?.decision
        ? "recovery_recorded"
        : undefined;
  if (!eventType) return undefined;
  const actor =
    doc.cancellationSummary?.requestedBy?.principalId ||
    doc.cancellationRequested?.requestedBy?.principalId ||
    doc.requestedBy?.principalId;
  return {
    schemaVersion: DEPLOYMENT_STAGE_STATE_AUDIT_SCHEMA,
    eventType,
    occurredAt: doc.completedAt || doc.updatedAt || new Date().toISOString(),
    deploymentId: safeText(doc.deploymentId || ""),
    environmentStage: safeText(
      doc.environmentStage || doc.admittedContext?.environmentStage || "unknown",
    ),
    deployRunId: safeText(doc.deployRunId || doc.submissionId),
    operationKind: safeText(doc.operationKind || "run_action"),
    sourceRevision: safeText(doc.artifact?.sourceRevision || doc.sourceRevision || "unknown"),
    artifactIdentity: safeText(doc.artifact?.artifactIdentity || doc.artifactIdentity || "unknown"),
    targetIdentity: safeText(doc.providerTargetIdentity || ""),
    ...(actor ? { actor: safeText(actor) } : {}),
    reason: safeText(
      doc.cancellationSummary?.terminalizationPath || doc.recovery?.decision || eventType,
    ),
    ...(doc.finalOutcome ? { finalOutcome: safeText(doc.finalOutcome) } : {}),
  };
}

export async function writeBackendStageStateAuditEvents(opts: {
  client: BackendQueryable;
  state: DeploymentCurrentStageState;
}) {
  for (const event of stageStateAuditEventsFor(opts.state)) {
    await appendAuditEvent({ client: opts.client, event });
  }
}

export async function writeBackendSubmissionAuditEvents(opts: {
  client: BackendQueryable;
  submission: unknown;
}) {
  const event = submissionAuditEvent(opts.submission);
  if (event) await appendAuditEvent({ client: opts.client, event });
}

async function appendAuditEvent(opts: {
  client: BackendQueryable;
  event: DeploymentStageStateAuditEvent | DeploymentStageStateAuditEventDraft;
}) {
  const {
    eventId: _eventId,
    auditSequence: _auditSequence,
    contentHash: _contentHash,
    eventHash: _eventHash,
    previousEventHash: _previousEventHash,
    ...draft
  } = opts.event as DeploymentStageStateAuditEvent;
  const contentHash = fingerprintValue(draft);
  const duplicate = (
    await opts.client.query<{ event_hash?: string }>(
      "SELECT event_hash FROM stage_state_audit_events WHERE content_hash = $1 LIMIT 1",
      [contentHash],
    )
  ).rows[0];
  if (duplicate) return;
  const previous = (
    await opts.client.query<{ event_hash?: string; audit_sequence?: number }>(
      `SELECT event_hash, audit_sequence FROM stage_state_audit_events
       WHERE deployment_id = $1 AND environment_stage = $2
       ORDER BY COALESCE(audit_sequence, 0) DESC, occurred_at DESC LIMIT 1`,
      [opts.event.deploymentId, opts.event.environmentStage],
    )
  ).rows[0];
  const event = {
    ...finalizeEvent(draft, previous?.event_hash),
    auditSequence: Number(previous?.audit_sequence || 0) + 1,
  };
  await opts.client.query(
    `INSERT INTO stage_state_audit_events (
        event_id, deployment_id, environment_stage, deploy_run_id, event_type, document_json,
        occurred_at, content_hash, event_hash, audit_sequence
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      ON CONFLICT(event_id) DO NOTHING`,
    [
      event.eventId,
      event.deploymentId,
      event.environmentStage,
      event.deployRunId,
      event.eventType,
      JSON.stringify(event),
      event.occurredAt,
      event.contentHash,
      event.eventHash,
      event.auditSequence,
    ],
  );
}

export async function readBackendStageStateAuditEvents(
  backend: NixosSharedHostControlPlaneBackendTarget,
  opts: { deploymentId: string; environmentStage?: string },
) {
  const params = opts.environmentStage
    ? [opts.deploymentId, opts.environmentStage]
    : [opts.deploymentId];
  const where = opts.environmentStage
    ? "deployment_id = $1 AND environment_stage = $2"
    : "deployment_id = $1";
  const rows = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      `SELECT document_json FROM stage_state_audit_events
       WHERE ${where}
       ORDER BY COALESCE(audit_sequence, 0) ASC, occurred_at ASC`,
      params,
    )
  ).rows;
  return rows
    .map((row) =>
      row.document_json
        ? decodeBackendJson<DeploymentStageStateAuditEvent>(row.document_json)
        : null,
    )
    .filter((row): row is DeploymentStageStateAuditEvent => Boolean(row));
}
