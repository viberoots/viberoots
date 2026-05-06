#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
  type VercelControlPlaneSubmitRequest,
} from "../../deployments/vercel-control-plane";
import {
  isDeploymentProviderServiceSubmitRequest,
  type DeploymentProviderServiceSubmitRequest,
} from "../../deployments/deployment-provider-control-plane-submit";
import { submitVercelDeploy, submitVercelPreviewCleanup } from "../../deployments/vercel-deploy";
import { submitVercelExactArtifactRun } from "../../deployments/vercel-exact-run";
import { resolveVercelReplaySource } from "../../deployments/vercel-replay";
import { vercelDeploymentFixture } from "./vercel.fixture";
import {
  deploymentWithVercelCleanupSecret,
  deploymentWithVercelSecret,
  withVercelFixtureSecrets,
  withVercelSmokeServer,
  writeVercelArtifact,
  writeVercelPublisherConfig,
} from "./vercel.control-plane.helpers";

const PUBLISH_AND_SMOKE_TOKEN = {
  "vercel/api-token": {
    value: "token-fixture",
    allowedSteps: ["publish", "smoke"],
    targetScopes: ["*"],
  },
};

test("Vercel control-plane submit request is recognized by the deployment provider router", () => {
  const request: VercelControlPlaneSubmitRequest = {
    schemaVersion: VERCEL_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
    submissionId: "submission-1",
    submittedAt: new Date().toISOString(),
    deployment: vercelDeploymentFixture(),
    operationKind: "deploy",
    artifactDir: "/tmp/artifact",
  };
  assert.equal(isDeploymentProviderServiceSubmitRequest(request), true);
  const downcast: DeploymentProviderServiceSubmitRequest = request;
  assert.equal(downcast.deployment.provider, "vercel");
});

test("Vercel direct deploy does not create replay without recorded admission", async () => {
  await withVercelFixtureSecrets(PUBLISH_AND_SMOKE_TOKEN, async (tmp) => {
    await withVercelSmokeServer(async (smokeConnectOverride) => {
      const deployment = deploymentWithVercelSecret();
      const recordsRoot = path.join(tmp, "records");
      await writeVercelPublisherConfig(tmp);
      const deployResult = await submitVercelDeploy({
        workspaceRoot: tmp,
        deployment,
        recordsRoot,
        artifactDir: await writeVercelArtifact(path.join(tmp, "artifact")),
        smokeConnectOverride,
      });
      assert.equal(deployResult.record.finalOutcome, "succeeded");
      assert.equal(deployResult.record.replaySnapshotPath, undefined);
    });
  });
});

test("Vercel replay source rejects records missing replaySnapshotPath", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-replay-missing-"));
  try {
    const recordPath = path.join(tmp, "runs", "deploy-x.json");
    await fsp.mkdir(path.dirname(recordPath), { recursive: true });
    await fsp.writeFile(
      recordPath,
      JSON.stringify({
        schemaVersion: "vercel-deploy-record@2026-05-03",
        deployRunId: "deploy-x",
        operationKind: "deploy",
        runClassification: "deploy",
        finalOutcome: "succeeded",
        deploymentId: "console-staging",
        deploymentLabel: "//projects/deployments/console-staging:deploy",
        provider: "vercel",
        providerTargetIdentity: "vercel:web-platform/console-staging#staging",
      }) + "\n",
    );
    await assert.rejects(
      () => resolveVercelReplaySource({ recordsRoot: tmp, deployRunId: "deploy-x" }),
      /vercel deploy record is missing replaySnapshotPath/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

const CLEANUP_TOKEN = {
  "vercel/api-token": {
    value: "cleanup-secret-token",
    allowedSteps: ["preview_cleanup"],
    targetScopes: ["*"],
  },
};

test("Vercel preview cleanup fails closed on ambiguous cleanup outcomes through the service boundary", async () => {
  await withVercelFixtureSecrets(CLEANUP_TOKEN, async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const ambiguousClient = {
      async publishPrebuilt() {
        throw new Error("not used in cleanup");
      },
      async cleanupPreview() {
        return { deploymentId: "", cleaned: false };
      },
    };
    let thrown: unknown;
    try {
      await submitVercelPreviewCleanup({
        deployment: deploymentWithVercelCleanupSecret(),
        recordsRoot,
        sourceRunId: "deploy-run-preview-amb",
        apiClient: ambiguousClient,
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof Error, "expected ambiguous cleanup to throw");
    assert.match((thrown as Error).message, /ambiguous cleanup outcome/);
    const failure = thrown as {
      record?: { operationKind?: string; finalOutcome?: string };
      recordPath?: string;
    };
    assert.ok(failure.record, "expected failure record on thrown error");
    assert.equal(failure.record!.operationKind, "preview_cleanup");
    assert.notEqual(failure.record!.finalOutcome, "succeeded");
    assert.ok(failure.recordPath, "expected recordPath on thrown error");
    const persisted = await fsp.readFile(failure.recordPath!, "utf8");
    assert.equal(persisted.includes("cleanup-secret-token"), false);
    assert.match(persisted, /ambiguous cleanup outcome/);
  });
});

test("Vercel exact-artifact run fails closed on ambiguous publish outcomes", async () => {
  await withVercelFixtureSecrets(PUBLISH_AND_SMOKE_TOKEN, async (tmp) => {
    const deployment = deploymentWithVercelSecret();
    const recordsRoot = path.join(tmp, "records");
    const ambiguousClient = {
      async publishPrebuilt() {
        return { deploymentId: "", url: "", aliasAssigned: false };
      },
    };
    await assert.rejects(
      () =>
        submitVercelExactArtifactRun({
          deployment,
          recordsRoot,
          operationKind: "retry",
          replaySnapshot: {
            schemaVersion: "vercel-replay-snapshot@1",
            deployRunId: "deploy-prior",
            createdAt: new Date().toISOString(),
            deploymentId: deployment.deploymentId,
            deploymentLabel: deployment.label,
            providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
            deployment,
            artifact: { identity: "vercel-next:abc123" },
            providerReleaseId: "dpl_prior",
            publicUrl: "https://prior.example/",
            aliasAssigned: true,
            providerConfigFingerprint: "sha256:abc",
          },
          parentRunId: "deploy-prior",
          releaseLineageId: "deploy-prior",
          artifactLineageId: "vercel-next:abc123",
          apiClient: ambiguousClient,
        }),
      /ambiguous publish outcome/,
    );
  });
});
