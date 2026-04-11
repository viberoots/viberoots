#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { readAppStoreConnectDeployRecord } from "../../deployments/app-store-connect-records.ts";
import { resolveAppStoreConnectReplaySource } from "../../deployments/app-store-connect-replay.ts";
import { resolveCloudflarePagesReplaySource } from "../../deployments/cloudflare-pages-replay.ts";
import { resolveGooglePlayReplaySource } from "../../deployments/google-play-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { appStoreConnectDeploymentFixture } from "./app-store-connect.fixture.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { googlePlayDeploymentFixture } from "./google-play.fixture.ts";

async function writeJson(filePath: string, value: unknown) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

test("app-store-connect record migration backfills runner identities", async () => {
  await runInTemp("app-store-connect-runner-identity-migrate", async (tmp) => {
    const deployment = appStoreConnectDeploymentFixture();
    const recordPath = path.join(tmp, "record.json");
    await writeJson(recordPath, {
      schemaVersion: "deploy-record@2026-04-09",
      deployRunId: "deploy-123",
      operationKind: "deploy",
      runClassification: "deploy",
      publishMode: "normal",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      provider: deployment.provider,
      providerTarget: deployment.providerTarget,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      admittedContext: { source: { sourceRevision: "rev-123" } },
      publisherType: deployment.publisher.type,
    });
    const record = await readAppStoreConnectDeployRecord(recordPath);
    assert.equal(record.schemaVersion, "deploy-record@2026-04-10");
    assert.equal(record.runnerIdentities.publisher, deployment.publisher.type);
    assert.equal(record.runnerIdentities.smoke, "app-store-connect-release-health@1");
  });
});

test("cloudflare-pages replay fails closed when stored runner provenance no longer matches", async () => {
  await runInTemp("cloudflare-pages-runner-identity-mismatch", async (tmp) => {
    const deployment = cloudflarePagesDeploymentFixture();
    const replaySnapshotPath = path.join(tmp, "records", "replay", "deploy-123", "snapshot.json");
    const recordPath = path.join(tmp, "records", "runs", "deploy-123.json");
    await writeJson(replaySnapshotPath, {
      schemaVersion: "cloudflare-pages-replay-snapshot@2",
      deployRunId: "deploy-123",
      createdAt: "2026-04-10T00:00:00.000Z",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      deploymentMetadataFingerprint: "sha256:meta",
      runnerIdentities: {
        publisher: deployment.publisher.type,
        smoke: "cloudflare-pages-static-webapp-smoke@1",
      },
      artifact: { kind: "static-webapp", identity: "artifact-123", storedArtifactPath: "/tmp/a" },
      admittedContext: { policyEvaluation: { checks: [], approvals: [] } },
      deployment,
      providerConfigSnapshotPath: "/tmp/config.json",
    });
    await writeJson(recordPath, {
      schemaVersion: "deploy-record@2026-04-10",
      deployRunId: "deploy-123",
      operationKind: "deploy",
      runClassification: "deploy",
      publishMode: "normal",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      provider: deployment.provider,
      providerTarget: deployment.providerTarget,
      effectiveRunTarget: deployment.providerTarget,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      admittedContext: { source: { sourceRevision: "rev-123" } },
      runnerIdentities: { publisher: `${deployment.publisher.type}@legacy` },
      replaySnapshotPath,
    });
    await assert.rejects(
      resolveCloudflarePagesReplaySource({ recordPath }),
      /publisher runner identity mismatch/,
    );
  });
});

test("app-store-connect replay fails closed when stored runner provenance no longer matches", async () => {
  await runInTemp("app-store-connect-runner-identity-mismatch", async (tmp) => {
    const deployment = appStoreConnectDeploymentFixture();
    const replaySnapshotPath = path.join(tmp, "records", "replay", "deploy-123", "snapshot.json");
    const recordPath = path.join(tmp, "records", "runs", "deploy-123.json");
    await writeJson(replaySnapshotPath, {
      schemaVersion: "app-store-connect-replay-snapshot@2",
      deployRunId: "deploy-123",
      createdAt: "2026-04-10T00:00:00.000Z",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      deploymentMetadataFingerprint: "sha256:meta",
      runnerIdentities: {
        publisher: deployment.publisher.type,
        smoke: "app-store-connect-release-health@1",
      },
      artifact: { kind: "mobile-app", identity: "artifact-123", storedArtifactPath: "/tmp/a" },
      admittedContext: { policyEvaluation: { checks: [], approvals: [] } },
      deployment,
      providerConfigSnapshotPath: "/tmp/config.json",
    });
    await writeJson(recordPath, {
      schemaVersion: "deploy-record@2026-04-10",
      deployRunId: "deploy-123",
      operationKind: "deploy",
      runClassification: "deploy",
      publishMode: "normal",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      provider: deployment.provider,
      providerTarget: deployment.providerTarget,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      admittedContext: { source: { sourceRevision: "rev-123" } },
      runnerIdentities: { publisher: `${deployment.publisher.type}@legacy` },
      replaySnapshotPath,
    });
    await assert.rejects(
      resolveAppStoreConnectReplaySource({ recordPath }),
      /publisher runner identity mismatch/,
    );
  });
});

test("google-play replay fails closed when stored runner provenance no longer matches", async () => {
  await runInTemp("google-play-runner-identity-mismatch", async (tmp) => {
    const deployment = googlePlayDeploymentFixture();
    const replaySnapshotPath = path.join(tmp, "records", "replay", "deploy-123", "snapshot.json");
    const recordPath = path.join(tmp, "records", "runs", "deploy-123.json");
    await writeJson(replaySnapshotPath, {
      schemaVersion: "google-play-replay-snapshot@2",
      deployRunId: "deploy-123",
      createdAt: "2026-04-10T00:00:00.000Z",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      deploymentMetadataFingerprint: "sha256:meta",
      runnerIdentities: {
        publisher: deployment.publisher.type,
        smoke: "google-play-release-health@1",
      },
      artifact: { kind: "mobile-app", identity: "artifact-123", storedArtifactPath: "/tmp/a" },
      admittedContext: { policyEvaluation: { checks: [], approvals: [] } },
      deployment,
      providerConfigSnapshotPath: "/tmp/config.json",
    });
    await writeJson(recordPath, {
      schemaVersion: "google-play-deploy-record@2",
      deployRunId: "deploy-123",
      operationKind: "deploy",
      runClassification: "deploy",
      publishMode: "normal",
      lifecycleState: "finished",
      terminationReason: null,
      finalOutcome: "succeeded",
      deploymentId: deployment.deploymentId,
      deploymentLabel: deployment.label,
      provider: deployment.provider,
      providerTarget: deployment.providerTarget,
      providerTargetIdentity: deployment.providerTarget.providerTargetIdentity,
      admittedContext: { source: { sourceRevision: "rev-123" } },
      runnerIdentities: { publisher: `${deployment.publisher.type}@legacy` },
      replaySnapshotPath,
    });
    await assert.rejects(
      resolveGooglePlayReplaySource({ recordPath }),
      /publisher runner identity mismatch/,
    );
  });
});
