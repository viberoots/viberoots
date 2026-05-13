#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { fingerprintValue } from "../../deployments/nixos-shared-host-deployment-fingerprint";
import { stageStateAuditChainFailures } from "../../deployments/deployment-stage-state-audit-chain";
import type { DeploymentStageStateAuditEvent } from "../../deployments/deployment-stage-state-audit";

function event(auditSequence: number, previousEventHash = ""): DeploymentStageStateAuditEvent {
  const content = {
    schemaVersion: "deployment-stage-state-audit-event@1" as const,
    eventType: "stage_state_updated" as const,
    occurredAt: "2026-05-12T12:00:00.000Z",
    deploymentId: "demoapp",
    environmentStage: "prod",
    deployRunId: `deploy-${auditSequence}`,
    operationKind: "deploy",
    sourceRevision: "rev",
    artifactIdentity: "artifact",
    targetIdentity: "target",
  };
  const contentHash = fingerprintValue(content);
  const eventHash = fingerprintValue({ contentHash, previousEventHash });
  return {
    ...content,
    eventId: eventHash,
    auditSequence,
    contentHash,
    eventHash,
    ...(previousEventHash ? { previousEventHash } : {}),
  };
}

test("audit chain verifier rejects changed skipped and duplicate sequences", () => {
  const first = event(1);
  const second = event(2, first.eventHash);
  const third = event(3, second.eventHash);
  assert.deepEqual(stageStateAuditChainFailures([first, second, third]), []);
  assert.match(
    stageStateAuditChainFailures([first, { ...second, auditSequence: 1 }, third]).join("\n"),
    /sequence mismatch/,
  );
  assert.match(
    stageStateAuditChainFailures([first, { ...second, auditSequence: 3 }, third]).join("\n"),
    /sequence mismatch/,
  );
  assert.match(
    stageStateAuditChainFailures([first, second, { ...third, auditSequence: 2 }]).join("\n"),
    /sequence mismatch/,
  );
  const missingSequence = { ...second } as Partial<DeploymentStageStateAuditEvent>;
  delete missingSequence.auditSequence;
  assert.match(
    stageStateAuditChainFailures([
      first,
      missingSequence as DeploymentStageStateAuditEvent,
      third,
    ]).join("\n"),
    /sequence mismatch/,
  );
});
