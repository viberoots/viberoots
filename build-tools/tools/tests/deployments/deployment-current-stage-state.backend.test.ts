#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  readBackendCurrentStageState,
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
  assert.match(formatDeploymentCurrentStageStateText(state!), /currentRunId: deploy-1/);
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
});

test("promotion retry and rollback replace current state and preserve history", async () => {
  const backend = await backendFixture();
  for (const [operationKind, runId, parentRunId] of [
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
  assert.equal(state?.currentRunId, "deploy-rollback");
  assert.equal(state?.parentRunId, "deploy-1");
  assert.deepEqual(
    history.map((entry) => entry.currentRunId).sort(),
    ["deploy-promotion", "deploy-retry", "deploy-rollback"].sort(),
  );
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
