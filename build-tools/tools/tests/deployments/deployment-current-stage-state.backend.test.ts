#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendCurrentStageState,
  readBackendStageStateAuditEvents,
  readBackendStageHistory,
  writeBackendDeployRecordDoc,
  writeBackendSnapshotDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { handleControlPlaneReadRoute } from "../../deployments/deployment-control-plane-read-routes";
import { formatDeploymentCurrentStageStateText } from "../../deployments/deployment-control-plane-status-format";
async function backendFixture() {
  const recordsRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-stage-state-"));
  const backend = {
    recordsRoot,
    databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot),
  };
  await writeBackendSnapshotDoc(
    backend,
    {
      submissionId: "cp-stage",
      deployment: {
        environmentStage: "staging",
        lanePolicy: { artifactReuseMode: "same_artifact" },
      },
    } as any,
    path.join(recordsRoot, "snapshots", "cp-stage.json"),
  );
  return backend;
}

function record(operationKind: string, deployRunId: string, parentRunId?: string) {
  return {
    deployRunId,
    operationKind,
    runClassification: operationKind,
    publishMode: "normal",
    lifecycleState: "finished",
    terminationReason: null,
    finalOutcome: "succeeded",
    deploymentId: "demoapp-staging",
    deploymentLabel: "//projects/deployments/demoapp-staging:deploy",
    provider: "nixos-shared-host",
    providerTargetIdentity: "nixos-shared-host:default:demoapp-staging",
    controlPlane: {
      submissionId: "cp-stage",
      workerId: "worker-1",
      admission: "admitted",
      lockScope: "nixos-shared-host:default:demoapp-staging",
    },
    ...(parentRunId ? { parentRunId } : {}),
    releaseLineageId: parentRunId || deployRunId,
    artifactLineageId: "static-webapp:abc123",
    artifact: { identity: "static-webapp:abc123" },
    replaySnapshotPath: path.join("/retained", `${deployRunId}-replay.json`),
    providerConfigSnapshotPath: path.join("/retained", `${deployRunId}-rendered.json`),
    provisionerPlan: {
      artifactPath: path.join("/retained", `${deployRunId}-plan.json`),
      fingerprint: "sha256:plan",
    },
    driftStatus: { state: "in_sync", checkedAt: "2026-04-01T00:00:00.000Z" },
    admittedContext: {
      source: {
        sourceRef: "main",
        sourceRevision: "abc123",
        sourceRunId: parentRunId,
      },
      policyEvaluation: {
        requestedBy: { principalId: "user:operator" },
        binding: {
          payloadFingerprint: "sha256:payload",
          artifactIdentity: "static-webapp:abc123",
          sourceRunId: parentRunId,
        },
        requiredApprovals: [{ name: "release-owner" }],
        requiredChecks: [
          {
            name: "deploy/demoapp-staging",
            status: "passed",
            reporterIdentity: "jenkins",
            recordRef: "checks://deploy/demoapp-staging",
          },
        ],
      },
    },
  };
}

test("current stage state updates from successful deploy and ignores release-pointer files", async () => {
  const backend = await backendFixture();
  await fsp.mkdir(path.join(backend.recordsRoot, "release-pointers"), { recursive: true });
  await fsp.writeFile(
    path.join(backend.recordsRoot, "release-pointers", "demoapp-staging.json"),
    JSON.stringify({ deployRunId: "stale-git-pointer" }),
  );
  await writeBackendDeployRecordDoc(
    backend,
    record("deploy", "deploy-1") as any,
    path.join(backend.recordsRoot, "runs", "deploy-1.json"),
  );
  const state = await readBackendCurrentStageState(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  assert.equal(state?.currentRunId, "deploy-1");
  assert.equal(state?.sourceRevision, "abc123");
  assert.equal(state?.artifactIdentity, "static-webapp:abc123");
  assert.equal(state?.artifactReuseMode, "same_artifact");
  assert.equal(state?.approvalContext?.requiredApprovals[0], "release-owner");
  assert.equal(state?.requiredChecks[0]?.name, "deploy/demoapp-staging");
  assert.equal(state?.driftStatus.state, "in_sync");
  assert.deepEqual(
    state?.retainedRenderEvidence.map((entry) => entry.kind).sort(),
    ["provider_config", "provisioner_plan", "replay_snapshot"].sort(),
  );
  assert.match(formatDeploymentCurrentStageStateText(state!), /currentRunId: deploy-1/);
  assert.match(formatDeploymentCurrentStageStateText(state!), /operationKind: deploy/);
  assert.match(formatDeploymentCurrentStageStateText(state!), /requiredChecks: deploy\/demoapp/);
  assert.match(formatDeploymentCurrentStageStateText(state!), /drift: in_sync/);
  const route = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/current-stage-state",
    searchParams: new URLSearchParams({
      deploymentId: "demoapp-staging",
      environmentStage: "staging",
    }),
    backend,
  });
  assert.equal(route.handled, true);
  assert.equal(route.handled ? (route.body as any).currentRunId : "", "deploy-1");
  assert.deepEqual(route.handled ? (route.body as any).rollbackCandidates : [], []);
  const audit = await readBackendStageStateAuditEvents(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  assert.equal(audit[0]?.eventType, "stage_state_updated");
  assert.equal(audit[0]?.sourceRevision, "abc123");
});

test("promotion retry and rollback replace current state and preserve history", async () => {
  const backend = await backendFixture();
  for (const [operationKind, runId, parentRunId] of [
    ["deploy", "deploy-1", undefined],
    ["promotion", "deploy-promotion", "deploy-1"],
    ["retry", "deploy-retry", "deploy-promotion"],
    ["rollback", "deploy-rollback", "deploy-1"],
  ]) {
    await writeBackendDeployRecordDoc(
      backend,
      record(operationKind, runId, parentRunId) as any,
      path.join(backend.recordsRoot, "runs", `${runId}.json`),
    );
  }
  const state = await readBackendCurrentStageState(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  const history = await readBackendStageHistory(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  const route = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/current-stage-state",
    searchParams: new URLSearchParams({
      deploymentId: "demoapp-staging",
      environmentStage: "staging",
    }),
    backend,
  });
  assert.equal(state?.currentRunId, "deploy-rollback");
  assert.equal(state?.parentRunId, "deploy-1");
  assert.deepEqual(
    route.handled
      ? (route.body as any).rollbackCandidates.map((candidate: any) => candidate.deployRunId).sort()
      : [],
    ["deploy-1", "deploy-promotion"].sort(),
  );
  assert.match(
    formatDeploymentCurrentStageStateText(route.handled ? (route.body as any) : state!),
    /rollbackLineage: deploy-1 -> deploy-rollback/,
  );
  assert.deepEqual(
    history.map((entry) => entry.currentRunId).sort(),
    ["deploy-1", "deploy-promotion", "deploy-retry", "deploy-rollback"].sort(),
  );
  const audit = await readBackendStageStateAuditEvents(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  assert.ok(audit.some((entry) => entry.eventType === "promotion_lineage_recorded"));
  assert.ok(audit.some((entry) => entry.eventType === "retry_lineage_recorded"));
  assert.ok(audit.some((entry) => entry.eventType === "rollback_lineage_recorded"));
  const routeAudit = await handleControlPlaneReadRoute({
    method: "GET",
    pathname: "/api/v1/stage-state-audit",
    searchParams: new URLSearchParams({
      deploymentId: "demoapp-staging",
      environmentStage: "staging",
    }),
    backend,
  });
  assert.equal(routeAudit.handled, true);
  assert.ok(routeAudit.handled && Array.isArray(routeAudit.body));
});

test("duplicate accepted submissions converge to the same stage-state effect", async () => {
  const backend = await backendFixture();
  await writeBackendDeployRecordDoc(
    backend,
    record("deploy", "deploy-idempotent") as any,
    path.join(backend.recordsRoot, "runs", "deploy-idempotent.json"),
  );
  await writeBackendDeployRecordDoc(
    backend,
    record("deploy", "deploy-idempotent") as any,
    path.join(backend.recordsRoot, "runs", "deploy-idempotent.json"),
  );
  const history = await readBackendStageHistory(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  assert.equal(history.length, 1);
  assert.equal(history[0]?.currentRunId, "deploy-idempotent");
});
test("stage state and audit redact suspicious artifact identities", async () => {
  const backend = await backendFixture();
  const doc = record("deploy", "deploy-secret") as any;
  doc.artifact.identity = "token=super-secret";
  await writeBackendDeployRecordDoc(
    backend,
    doc,
    path.join(backend.recordsRoot, "runs", "deploy-secret.json"),
  );
  const state = await readBackendCurrentStageState(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  const audit = await readBackendStageStateAuditEvents(backend, {
    deploymentId: "demoapp-staging",
    environmentStage: "staging",
  });
  assert.ok(!JSON.stringify({ state, audit }).includes("super-secret"));
  assert.match(String(state?.artifactIdentity), /sensitive payload redacted/);
});
