#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileNixosSharedHostRecoveredSubmission } from "../../deployments/nixos-shared-host-recovery.ts";
import {
  createNixosSharedHostDeployRecord,
  writeNixosSharedHostDeployRecord,
} from "../../deployments/nixos-shared-host-records.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

async function writeSubmission(filePath: string, value: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("recovery converges to the existing authoritative record and preserves cancellation facts", async () => {
  await runInTemp("deployment-control-plane-recovery-converges", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const submissionPath = path.join(recordsRoot, "control-plane", "submissions", "cp-1.json");
    const deployment = nixosSharedHostDeploymentFixture();
    await writeSubmission(submissionPath, {
      schemaVersion: "nixos-shared-host-control-plane-submission@3",
      submissionId: "cp-1",
      submittedAt: "2026-04-08T10:00:00.000Z",
      operationKind: "deploy",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
      lockScope: deployment.providerTarget.sharedDevTargetIdentity,
      executionSnapshotPath: path.join(recordsRoot, "control-plane", "snapshots", "cp-1.json"),
      lifecycleState: "cancelling",
      terminationReason: null,
      dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
      admission: { decision: "admitted", reason: "shared_nonprod" },
      execution: { currentStep: "publish", mutationStartedAt: "2026-04-08T10:00:05.000Z" },
      cancellationRequested: {
        requestedAt: "2026-04-08T10:00:06.000Z",
        requestedBy: { principalId: "user:operator" },
      },
    });
    const record = createNixosSharedHostDeployRecord(deployment, {
      deployRunId: "deploy-1",
      runClassification: "deploy",
      finalOutcome: "succeeded",
      artifactIdentity: "static-webapp:abc123",
      authority: {
        kind: "control-plane-worker",
        submissionId: "cp-1",
        submissionPath,
        workerId: "worker-1",
        lockScope: deployment.providerTarget.sharedDevTargetIdentity,
        executionSnapshotPath: path.join(recordsRoot, "control-plane", "snapshots", "cp-1.json"),
      },
    });
    const recordPath = await writeNixosSharedHostDeployRecord(recordsRoot, record);
    const recovered = await reconcileNixosSharedHostRecoveredSubmission({
      submissionPath,
      recordsRoot,
      recoveredBy: { principalId: "user:recovery" },
    });
    assert.equal(recovered.lifecycleState, "finished");
    assert.equal(recovered.deployRunId, "deploy-1");
    assert.equal(recovered.resultRecordPath, recordPath);
    assert.equal(recovered.finalOutcome, "succeeded");
    assert.equal(recovered.recovery?.providerReconciliation, "mutation_completed");
    assert.equal(recovered.recovery?.decision, "converged_to_final_record");
    assert.equal(
      recovered.cancellationSummary?.terminalizationPath,
      "finished_after_reconciliation",
    );
  });
});

test("recovery fails closed when reconciliation cannot prove whether mutation happened", async () => {
  await runInTemp("deployment-control-plane-recovery-fail-closed", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const submissionPath = path.join(recordsRoot, "control-plane", "submissions", "cp-2.json");
    const deployment = nixosSharedHostDeploymentFixture();
    await writeSubmission(submissionPath, {
      schemaVersion: "nixos-shared-host-control-plane-submission@3",
      submissionId: "cp-2",
      submittedAt: "2026-04-08T10:00:00.000Z",
      operationKind: "deploy",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: deployment.providerTarget.sharedDevTargetIdentity,
      lockScope: deployment.providerTarget.sharedDevTargetIdentity,
      executionSnapshotPath: path.join(recordsRoot, "control-plane", "snapshots", "cp-2.json"),
      lifecycleState: "running",
      terminationReason: null,
      dedupe: { mode: "created", requestFingerprint: "sha256:submit" },
      admission: { decision: "admitted", reason: "shared_nonprod" },
      execution: { currentStep: "publish", mutationStartedAt: "2026-04-08T10:00:05.000Z" },
    });
    const recovered = await reconcileNixosSharedHostRecoveredSubmission({
      submissionPath,
      recordsRoot,
    });
    assert.equal(recovered.lifecycleState, "finished");
    assert.equal(recovered.resultRecordPath, undefined);
    assert.equal(recovered.recovery?.providerReconciliation, "inconclusive");
    assert.equal(recovered.recovery?.decision, "terminated_for_operator_follow_up");
  });
});
