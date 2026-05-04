#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readDeploymentControlPlaneObservability } from "../../deployments/deployment-control-plane-observability";
import { runInTemp } from "../lib/test-helpers";

async function writeJson(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("control-plane observability derives lifecycle events, metrics, alerts, and operator views", async () => {
  await runInTemp("deployment-control-plane-observability", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const submissionRoot = path.join(recordsRoot, "control-plane", "submissions");
    const runRoot = path.join(recordsRoot, "runs");
    const artifactRoot = path.join(recordsRoot, "artifacts");
    await writeJson(path.join(submissionRoot, "cp-queued.json"), {
      submissionId: "cp-queued",
      submittedAt: "2026-04-08T10:00:00.000Z",
      deploymentId: "deploy-a",
      deploymentLabel: "//projects/deployments/a:deploy",
      providerTargetIdentity: "target-a",
      lockScope: "target-a",
      lifecycleState: "waiting_for_lock",
    });
    await writeJson(path.join(submissionRoot, "cp-running.json"), {
      submissionId: "cp-running",
      submittedAt: "2026-04-08T10:02:00.000Z",
      completedAt: "2026-04-08T10:06:00.000Z",
      deploymentId: "deploy-b",
      deploymentLabel: "//projects/deployments/b:deploy",
      providerTargetIdentity: "target-b",
      lockScope: "target-b",
      lifecycleState: "running",
      execution: {
        currentStep: "publish",
        mutationStartedAt: "2026-04-08T10:03:00.000Z",
      },
      recovery: { decision: "converged_to_final_record" },
      cancellationRequested: { requestedAt: "2026-04-08T10:04:00.000Z" },
    });
    await writeJson(path.join(submissionRoot, "cp-lock.json"), {
      submissionId: "cp-lock",
      submittedAt: "2026-04-08T10:01:00.000Z",
      deploymentId: "deploy-c",
      deploymentLabel: "//projects/deployments/c:deploy",
      providerTargetIdentity: "target-c",
      lockScope: "target-c",
      lifecycleState: "finished",
      rejectionCode: "lock_conflict",
    });
    await writeJson(path.join(artifactRoot, "replay.json"), { secret: "redact-me" });
    await writeJson(path.join(artifactRoot, "plan.json"), { secret: "redact-me-too" });
    await writeJson(path.join(artifactRoot, "execution.json"), { token: "top-secret" });
    await writeJson(path.join(artifactRoot, "break-glass.json"), {
      justification: "internal-only",
    });
    await writeJson(path.join(runRoot, "deploy-1.json"), {
      deployRunId: "deploy-1",
      deploymentId: "deploy-b",
      deploymentLabel: "//projects/deployments/b:deploy",
      providerTargetIdentity: "target-b",
      finalOutcome: "publish_failed",
      failedStep: "publish",
      replaySnapshotPath: path.join(artifactRoot, "replay.json"),
      provisionerPlan: { artifactPath: path.join(artifactRoot, "plan.json") },
      controlPlane: { executionSnapshotPath: path.join(artifactRoot, "execution.json") },
      breakGlass: { evidencePath: path.join(artifactRoot, "break-glass.json") },
      error: "publish redacted (sha256:error-1)",
      errorFingerprint: "sha256:error-1",
    });
    await writeJson(path.join(runRoot, "deploy-2.json"), {
      deployRunId: "deploy-2",
      deploymentId: "deploy-c",
      deploymentLabel: "//projects/deployments/c:deploy",
      providerTargetIdentity: "target-c",
      operationKind: "preview_cleanup",
      finalOutcome: "publish_failed",
      failedStep: "preview_cleanup",
    });
    await writeJson(path.join(recordsRoot, "control-plane", "resilience", "latest.json"), {
      latestBackup: { createdAt: "2026-04-08T09:00:00.000Z" },
      latestRestoreTest: {
        testedAt: "2026-04-08T09:30:00.000Z",
        status: "failed",
      },
    });

    const observability = await readDeploymentControlPlaneObservability(
      recordsRoot,
      new Date("2026-04-08T10:10:00.000Z"),
    );

    assert.equal(observability.metrics.queueDepth, 1);
    assert.equal(observability.metrics.lockContentionCount, 1);
    assert.equal(observability.metrics.failureCountsByOutcome.publish_failed, 2);
    assert.equal(observability.metrics.failureCountsByStep.publish, 1);
    assert.equal(observability.metrics.failureCountsByStep.preview_cleanup, 1);
    assert.equal(observability.metrics.inDoubtRunCount, 1);
    assert.equal(observability.metrics.recoveredRunCount, 1);
    assert.deepEqual(observability.alerts.map((entry) => entry.code).sort(), [
      "in_doubt_runs_present",
      "lock_contention",
      "repeated_target_failure",
      "restore_test_failed",
    ]);
    assert.ok(observability.events.some((entry) => entry.category === "mutation"));
    assert.ok(observability.events.some((entry) => entry.category === "recovery"));
    assert.ok(observability.events.some((entry) => entry.category === "break_glass"));
    assert.ok(observability.events.some((entry) => entry.category === "preview_cleanup"));
    assert.equal(observability.views.queue[0]?.submissionId, "cp-queued");
    assert.equal(observability.views.locks[0]?.lockScope, "target-a");
    assert.equal(
      observability.views.runs[0]?.operatorArtifacts[0]?.classification,
      "reference_only",
    );
    assert.equal(observability.views.resilience.latestRestoreTestStatus, "failed");
  });
});
