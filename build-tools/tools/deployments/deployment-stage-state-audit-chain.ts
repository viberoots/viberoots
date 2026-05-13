#!/usr/bin/env zx-wrapper
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import type { DeploymentStageStateAuditEvent } from "./deployment-stage-state-audit";

function eventContent(event: DeploymentStageStateAuditEvent) {
  const {
    eventId: _eventId,
    auditSequence: _auditSequence,
    contentHash: _contentHash,
    eventHash: _eventHash,
    previousEventHash: _previousEventHash,
    ...content
  } = event;
  return content;
}

export function stageStateAuditChainFailures(events: DeploymentStageStateAuditEvent[]): string[] {
  const failures: string[] = [];
  let previousHash = "";
  events.forEach((event, index) => {
    if (event.auditSequence !== index + 1) {
      failures.push(`audit event ${index + 1} sequence mismatch`);
    }
    const contentHash = fingerprintValue(eventContent(event));
    if (event.contentHash !== contentHash) {
      failures.push(`audit event ${index + 1} content hash mismatch`);
    }
    if ((event.previousEventHash || "") !== previousHash) {
      failures.push(`audit event ${index + 1} previous hash mismatch`);
    }
    const eventHash = fingerprintValue({
      contentHash: event.contentHash,
      previousEventHash: event.previousEventHash || "",
    });
    if (event.eventHash !== eventHash || event.eventId !== eventHash) {
      failures.push(`audit event ${index + 1} event hash mismatch`);
    }
    previousHash = event.eventHash;
  });
  return failures;
}
