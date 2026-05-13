#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handleControlPlaneReadRoute } from "../../deployments/deployment-control-plane-read-routes";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendStageStateAuditEvents,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";

async function backendFixture() {
  const recordsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-stage-state-list-"));
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function seedState(
  backend: Awaited<ReturnType<typeof backendFixture>>,
  opts: { deploymentId: string; stage: string; runId: string; operationKind?: string },
) {
  const submissionId = `cp-${opts.runId}`;
  await writeBackendSnapshotDoc(
    backend,
    {
      submissionId,
      deployment: {
        environmentStage: opts.stage,
        lanePolicy: { artifactReuseMode: "same_artifact" },
      },
    } as any,
    path.join(backend.recordsRoot, "snapshots", `${submissionId}.json`),
  );
  await writeBackendDeployRecordDoc(
    backend,
    {
      deployRunId: opts.runId,
      operationKind: opts.operationKind || "deploy",
      runClassification: opts.operationKind || "deploy",
      publishMode: "normal",
      lifecycleState: "finished",
      finalOutcome: "succeeded",
      deploymentId: opts.deploymentId,
      deploymentLabel: `//projects/deployments/${opts.deploymentId}:deploy`,
      providerTargetIdentity: `nixos-shared-host:default:${opts.deploymentId}`,
      controlPlane: { submissionId, workerId: "worker-1", admission: "admitted" },
      artifact: { identity: `static-webapp:${opts.runId}` },
      componentArtifacts: [
        {
          identity: `oci:${opts.runId}`,
          storedArtifactPath: `/retained/${opts.runId}-oci`,
          provenancePath: `/retained/${opts.runId}-oci.json`,
        },
      ],
      replaySnapshotPath: path.join("/retained", `${opts.runId}-replay.json`),
      admittedContext: {
        source: { sourceRevision: `rev-${opts.runId}` },
        policyEvaluation: {
          requestedBy: { principalId: "user:operator" },
          requiredApprovals: [{ name: "release-owner" }],
          requiredChecks: [
            {
              name: "deploy/demoapp",
              status: "passed",
              reporterIdentity: "jenkins",
              recordRef: "checks://deploy/demoapp",
            },
          ],
        },
      },
      driftStatus: { state: "in_sync", summary: "stage is synced" },
    } as any,
    path.join(backend.recordsRoot, "runs", `${opts.runId}.json`),
  );
}

test("current-stage API lists by deployment and by environment stage", async () => {
  const backend = await backendFixture();
  await seedState(backend, { deploymentId: "demoapp", stage: "dev", runId: "deploy-dev" });
  await seedState(backend, { deploymentId: "demoapp", stage: "prod", runId: "deploy-prod" });
  await seedState(backend, { deploymentId: "otherapp", stage: "prod", runId: "deploy-other" });
  const byDeployment = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/current-stage-state",
    searchParams: new URLSearchParams({ deploymentId: "demoapp" }),
    backend,
  });
  const byStage = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/current-stage-state",
    searchParams: new URLSearchParams({ environmentStage: "prod" }),
    backend,
  });
  assert.deepEqual(
    byDeployment.handled ? (byDeployment.body as any[]).map((entry) => entry.currentRunId) : [],
    ["deploy-dev", "deploy-prod"],
  );
  assert.deepEqual(
    byStage.handled ? (byStage.body as any[]).map((entry) => entry.deploymentId).sort() : [],
    ["demoapp", "otherapp"],
  );
  const listed = byDeployment.handled ? (byDeployment.body as any[])[0] : {};
  assert.ok(
    listed.retainedArtifactEvidence.some((entry: any) => entry.identity === "oci:deploy-dev"),
  );
});

test("status and audit redact checks evidence and drift fields", async () => {
  const backend = await backendFixture();
  await seedState(backend, { deploymentId: "demoapp", stage: "prod", runId: "deploy-secret" });
  const doc = {
    deployRunId: "deploy-secret-2",
    operationKind: "deploy",
    runClassification: "deploy",
    publishMode: "normal",
    lifecycleState: "finished",
    finalOutcome: "succeeded",
    deploymentId: "demoapp",
    deploymentLabel: "//projects/deployments/demoapp:deploy",
    providerTargetIdentity: "nixos-shared-host:default:demoapp",
    controlPlane: { submissionId: "cp-deploy-secret", workerId: "worker-1", admission: "admitted" },
    artifact: { identity: "token=artifact-secret" },
    replaySnapshotPath: "/retained/token=render-secret.json",
    provisionerPlan: {
      artifactPath: "/retained/plan.json",
      fingerprint: "token=fingerprint-secret",
    },
    admittedContext: {
      source: { sourceRevision: "token=revision-secret" },
      policyEvaluation: {
        requestedBy: { principalId: "token=requester-secret" },
        binding: { payloadFingerprint: "token=approval-secret" },
        requiredChecks: [
          {
            name: "deploy/demoapp",
            reporterIdentity: "token=reporter-secret",
            recordRef: "authorization=Bearer hidden",
          },
        ],
      },
    },
    driftStatus: { state: "drifted", summary: "password=drift-secret", fingerprint: "token=drift" },
  };
  await writeBackendDeployRecordDoc(
    backend,
    doc as any,
    path.join(backend.recordsRoot, "runs", "deploy-secret-2.json"),
  );
  const route = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/current-stage-state",
    searchParams: new URLSearchParams({ deploymentId: "demoapp", environmentStage: "prod" }),
    backend,
  });
  const audit = await readBackendStageStateAuditEvents(backend, {
    deploymentId: "demoapp",
    environmentStage: "prod",
  });
  const history = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/stage-history",
    searchParams: new URLSearchParams({ deploymentId: "demoapp", environmentStage: "prod" }),
    backend,
  });
  const visible = JSON.stringify({
    route: route.handled ? route.body : null,
    history: history.handled ? history.body : null,
    audit,
  });
  assert.ok(!visible.includes("artifact-secret"));
  assert.ok(!visible.includes("reporter-secret"));
  assert.ok(!visible.includes("render-secret"));
  assert.ok(!visible.includes("fingerprint-secret"));
  assert.ok(!visible.includes("drift-secret"));
  assert.ok(!visible.includes("requester-secret"));
  assert.ok(!visible.includes("approval-secret"));
  assert.match(visible, /sensitive payload redacted/);
});

test("audit is append-only and covers lineage cancellation and recovery updates", async () => {
  const backend = await backendFixture();
  await seedState(backend, { deploymentId: "demoapp", stage: "prod", runId: "deploy-1" });
  await seedState(backend, {
    deploymentId: "demoapp",
    stage: "prod",
    runId: "deploy-promotion",
    operationKind: "promotion",
  });
  await seedState(backend, {
    deploymentId: "demoapp",
    stage: "prod",
    runId: "deploy-rollback",
    operationKind: "rollback",
  });
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId: "cancel-1",
      executionSnapshotPath: path.join(backend.recordsRoot, "snapshots", "cancel-1.json"),
      lockScope: "nixos-shared-host:default:demoapp",
      lifecycleState: "cancelled",
      deploymentId: "demoapp",
      environmentStage: "prod",
      requestedBy: { principalId: "user:operator" },
      cancellationSummary: { terminalizationPath: "operator requested cancellation" },
    } as any,
    {
      submissionPath: path.join(backend.recordsRoot, "submissions", "cancel-1.json"),
      executionSnapshotPath: "",
    },
  );
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId: "recover-1",
      executionSnapshotPath: path.join(backend.recordsRoot, "snapshots", "recover-1.json"),
      lockScope: "nixos-shared-host:default:demoapp",
      lifecycleState: "finished",
      deploymentId: "demoapp",
      environmentStage: "prod",
      requestedBy: { principalId: "user:operator" },
      recovery: { decision: "resume after in-doubt recovery" },
    } as any,
    {
      submissionPath: path.join(backend.recordsRoot, "submissions", "recover-1.json"),
      executionSnapshotPath: "",
    },
  );
  const audit = await readBackendStageStateAuditEvents(backend, {
    deploymentId: "demoapp",
    environmentStage: "prod",
  });
  assert.ok(audit.some((event) => event.eventType === "promotion_lineage_recorded"));
  assert.ok(audit.some((event) => event.eventType === "rollback_lineage_recorded"));
  assert.ok(audit.some((event) => event.eventType === "cancellation_recorded"));
  assert.ok(audit.some((event) => event.eventType === "recovery_recorded"));
  assert.ok(audit.every((event) => event.contentHash && event.eventHash));
  assert.deepEqual(
    audit.map((event) => event.auditSequence),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.ok(audit.some((event) => event.actor === "user:operator"));
  assert.ok(audit.some((event) => event.requiredChecks?.includes("deploy/demoapp")));
});
