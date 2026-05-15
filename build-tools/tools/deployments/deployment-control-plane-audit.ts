#!/usr/bin/env zx-wrapper
import { redactOperatorText } from "./deployment-control-plane-redaction";
import {
  decodeBackendJson,
  queryBackend,
  type BackendQueryable,
  type NixosSharedHostControlPlaneBackendTarget,
} from "./nixos-shared-host-control-plane-backend-db";

export const DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA = "deployment-control-plane-audit-event@1";

export type DeploymentControlPlaneAuditEvent = {
  schemaVersion: typeof DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA;
  eventId: string;
  requestId: string;
  actor: string;
  operation: string;
  idempotencyKey?: string;
  deploymentId: string;
  result: string;
  failureSummary?: string;
  occurredAt: string;
};

function safeText(value: unknown): string {
  const text = String(value || "").trim();
  const redacted = redactOperatorText(text);
  return redacted?.redacted ? redacted.summary : text;
}

function submissionFailureSummary(doc: any): string | undefined {
  const topLevelRejection = [doc.rejectionCode, doc.rejectionMessage].filter(Boolean).join(": ");
  return (
    doc.failureSummary ||
    doc.cancellationSummary?.terminalizationPath ||
    doc.recovery?.decision ||
    doc.latestAction?.rejectionCode ||
    topLevelRejection ||
    undefined
  );
}

function auditEventForSubmission(doc: any): DeploymentControlPlaneAuditEvent | null {
  if (!doc?.submissionId || !doc?.deploymentId) return null;
  const latestAction = doc.latestAction;
  const requestId = latestAction?.actionId || doc.submissionId;
  const actor =
    latestAction?.requestedBy?.principalId ||
    doc.requestedBy?.principalId ||
    doc.cancellationRequested?.requestedBy?.principalId ||
    "service:deployment-control-plane";
  const idempotencyKey = latestAction?.dedupe?.idempotencyKey || doc.dedupe?.idempotencyKey;
  const result = doc.finalOutcome || doc.terminationReason || doc.lifecycleState || "unknown";
  const failureSummary = submissionFailureSummary(doc);
  return {
    schemaVersion: DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA,
    eventId: `audit-${requestId}-${safeText(result)}`,
    requestId: safeText(requestId),
    actor: safeText(actor),
    operation: safeText(latestAction?.action || doc.operationKind || "submit"),
    ...(idempotencyKey ? { idempotencyKey: safeText(idempotencyKey) } : {}),
    deploymentId: safeText(doc.deploymentId),
    result: safeText(result),
    ...(failureSummary ? { failureSummary: safeText(failureSummary) } : {}),
    occurredAt: safeText(
      latestAction?.submittedAt || doc.completedAt || doc.submittedAt || new Date().toISOString(),
    ),
  };
}

async function insertBackendControlPlaneAuditEvent(opts: {
  client: BackendQueryable;
  event: DeploymentControlPlaneAuditEvent;
}) {
  const event = {
    ...opts.event,
    eventId: safeText(opts.event.eventId),
    requestId: safeText(opts.event.requestId),
    actor: safeText(opts.event.actor),
    operation: safeText(opts.event.operation),
    ...(opts.event.idempotencyKey ? { idempotencyKey: safeText(opts.event.idempotencyKey) } : {}),
    deploymentId: safeText(opts.event.deploymentId),
    result: safeText(opts.event.result),
    ...(opts.event.failureSummary ? { failureSummary: safeText(opts.event.failureSummary) } : {}),
    occurredAt: safeText(opts.event.occurredAt),
  };
  await opts.client.query(
    `INSERT INTO control_plane_audit_events (
       event_id, request_id, actor, operation, idempotency_key, deployment_id, result,
       failure_summary, document_json, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT(event_id) DO NOTHING`,
    [
      event.eventId,
      event.requestId,
      event.actor,
      event.operation,
      event.idempotencyKey || null,
      event.deploymentId,
      event.result,
      event.failureSummary || null,
      JSON.stringify(event),
      event.occurredAt,
    ],
  );
  return event;
}

export async function writeBackendControlPlaneAuditEvent(opts: {
  client: BackendQueryable;
  submission: unknown;
}) {
  const event = auditEventForSubmission(opts.submission);
  if (!event) return null;
  return await insertBackendControlPlaneAuditEvent({ client: opts.client, event });
}

export async function writeBackendControlPlaneRunActionFailureAuditEvent(opts: {
  client: BackendQueryable;
  requestId: string;
  actor?: string;
  operation: string;
  idempotencyKey?: string;
  deploymentId: string;
  failureSummary: string;
  occurredAt?: string;
}) {
  return await insertBackendControlPlaneAuditEvent({
    client: opts.client,
    event: {
      schemaVersion: DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA,
      eventId: `audit-${opts.requestId}-failed`,
      requestId: opts.requestId,
      actor: opts.actor || "service:deployment-control-plane",
      operation: opts.operation,
      ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      deploymentId: opts.deploymentId,
      result: "failed",
      failureSummary: opts.failureSummary,
      occurredAt: opts.occurredAt || new Date().toISOString(),
    },
  });
}

export async function writeBackendControlPlaneMcpAuditEvent(opts: {
  client: BackendQueryable;
  requestId: string;
  actor?: string;
  operation: string;
  deploymentId?: string;
  result: "success" | "failed";
  failureSummary?: string;
  occurredAt?: string;
}) {
  return await insertBackendControlPlaneAuditEvent({
    client: opts.client,
    event: {
      schemaVersion: DEPLOYMENT_CONTROL_PLANE_AUDIT_SCHEMA,
      eventId: `audit-${opts.requestId}-${opts.result}`,
      requestId: opts.requestId,
      actor: opts.actor || "service:deployment-control-plane",
      operation: opts.operation,
      deploymentId: opts.deploymentId || "control-plane",
      result: opts.result,
      ...(opts.failureSummary ? { failureSummary: opts.failureSummary } : {}),
      occurredAt: opts.occurredAt || new Date().toISOString(),
    },
  });
}

export async function readBackendControlPlaneAuditEvents(
  backend: NixosSharedHostControlPlaneBackendTarget,
  deploymentId: string,
) {
  const rows = (
    await queryBackend<{ document_json?: unknown }>(
      backend,
      `SELECT document_json FROM control_plane_audit_events
       WHERE deployment_id = $1
       ORDER BY occurred_at ASC, event_id ASC`,
      [deploymentId],
    )
  ).rows;
  return rows
    .map((row) =>
      row.document_json
        ? decodeBackendJson<DeploymentControlPlaneAuditEvent>(row.document_json)
        : null,
    )
    .filter((row): row is DeploymentControlPlaneAuditEvent => Boolean(row));
}
