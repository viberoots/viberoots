#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  readDeploymentControlPlaneResilienceStatus,
  runDeploymentControlPlaneRestoreTest,
} from "../../deployments/deployment-control-plane-resilience";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("control-plane restore test persists operator-visible resilience state", async () => {
  await runInTemp("deployment-control-plane-restore-test", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-restore-1",
      artifactIdentity: "artifact-restore-1",
      artifactLineageId: "artifact-restore-1",
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      await fsp.mkdir(path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp"), {
        recursive: true,
      });
      const retainedEvidencePath = path.join(
        recordsRoot,
        "control-plane",
        "render",
        "restore.json",
      );
      await fsp.mkdir(path.dirname(retainedEvidencePath), { recursive: true });
      await fsp.writeFile(retainedEvidencePath, JSON.stringify({ runId: "restore-current" }));
      const artifactBlobRoot = path.join(recordsRoot, "artifacts", "blobs");
      const artifactProvenanceRoot = path.join(recordsRoot, "artifacts", "provenance");
      const artifactPath = path.join(artifactBlobRoot, "artifact-restore-1");
      const provenancePath = path.join(artifactProvenanceRoot, "artifact-restore-1.json");
      const componentArtifactPath = path.join(artifactBlobRoot, "oci-restore-1");
      const componentProvenancePath = path.join(artifactProvenanceRoot, "oci-restore-1.json");
      await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
      await fsp.mkdir(path.dirname(provenancePath), { recursive: true });
      await fsp.writeFile(artifactPath, "artifact\n", "utf8");
      await fsp.writeFile(
        provenancePath,
        JSON.stringify({ artifactIdentity: "artifact-restore-1" }),
      );
      await fsp.writeFile(componentArtifactPath, "oci artifact\n", "utf8");
      await fsp.writeFile(
        componentProvenancePath,
        JSON.stringify({ artifactIdentity: "oci-restore-1" }),
      );
      await fsp.writeFile(
        path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp", "dev.json"),
        JSON.stringify(
          {
            schemaVersion: "deployment-current-stage-state@1",
            deploymentId: deployment.deploymentId,
            deploymentLabel: deployment.label,
            environmentStage: deployment.environmentStage,
            providerTargetIdentity: "nixos-shared-host:default:demo",
            currentRunId: "restore-current",
            operationKind: "deploy",
            sourceRevision: "rev-restore-1",
            artifactIdentity: "artifact-restore-1",
            artifactReuseMode: "same_artifact",
            finalOutcome: "succeeded",
            updatedAt: "2026-05-12T12:00:00.000Z",
            requiredChecks: [],
            retainedRenderEvidence: [
              {
                kind: "replay_snapshot",
                referencePath: retainedEvidencePath,
              },
            ],
            retainedArtifactEvidence: [
              {
                identity: "artifact-restore-1",
                storedArtifactPath: artifactPath,
                provenancePath,
              },
              {
                identity: "oci-restore-1",
                storedArtifactPath: componentArtifactPath,
                provenancePath: componentProvenancePath,
              },
            ],
            driftStatus: { state: "not_checked" },
          },
          null,
          2,
        ) + "\n",
      );
      const status = await runDeploymentControlPlaneRestoreTest({
        recordsRoot,
        backupRoot: path.join(tmp, "backups"),
        restoreRoot: path.join(tmp, "restore"),
        protectionClass: "shared_nonprod",
      });
      assert.equal(status.latestRestoreTest?.status, "passed");
      assert.ok((status.latestRestoreTest?.restoredRunCount || 0) >= 1);
      assert.ok((status.latestRestoreTest?.restoredSubmissionCount || 0) >= 1);
      assert.ok((status.latestRestoreTest?.restoredCurrentStageStateCount || 0) >= 1);
      assert.ok((status.latestRestoreTest?.retainedArtifactReferenceCount || 0) >= 5);
      const persisted = await readDeploymentControlPlaneResilienceStatus(recordsRoot);
      assert.equal(persisted?.schemaVersion, "deployment-control-plane-resilience-status@1");
      assert.equal(persisted?.latestRestoreTest?.status, "passed");
    } finally {
      await server.close();
    }
  });
});

test("control-plane restore validation fails missing artifact provenance", async () => {
  await runInTemp("deployment-control-plane-restore-artifact-provenance", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const evidencePath = path.join(recordsRoot, "control-plane", "render", "restore.json");
    const artifactPath = path.join(recordsRoot, "artifacts", "blobs", "artifact-restore-1");
    await fsp.mkdir(path.dirname(evidencePath), { recursive: true });
    await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
    await fsp.writeFile(evidencePath, "{}\n", "utf8");
    await fsp.writeFile(artifactPath, "artifact\n", "utf8");
    await fsp.mkdir(path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp", "dev.json"),
      JSON.stringify(
        {
          schemaVersion: "deployment-current-stage-state@1",
          deploymentId: "demoapp",
          deploymentLabel: "//demo:deploy",
          environmentStage: "dev",
          providerTargetIdentity: "nixos-shared-host:default:demo",
          currentRunId: "restore-current",
          operationKind: "deploy",
          sourceRevision: "rev-restore-1",
          artifactIdentity: "artifact-restore-1",
          artifactReuseMode: "same_artifact",
          finalOutcome: "succeeded",
          updatedAt: "2026-05-12T12:00:00.000Z",
          requiredChecks: [],
          retainedRenderEvidence: [{ kind: "replay_snapshot", referencePath: evidencePath }],
          retainedArtifactEvidence: [
            {
              identity: "artifact-restore-1",
              storedArtifactPath: artifactPath,
              provenancePath: path.join(recordsRoot, "artifacts", "provenance", "missing.json"),
            },
          ],
          driftStatus: { state: "not_checked" },
        },
        null,
        2,
      ) + "\n",
    );
    const status = await runDeploymentControlPlaneRestoreTest({
      recordsRoot,
      backupRoot: path.join(tmp, "backups"),
      restoreRoot: path.join(tmp, "restore"),
      protectionClass: "shared_nonprod",
    });
    assert.equal(status.latestRestoreTest?.status, "failed");
    assert.match(status.latestRestoreTest?.error || "", /artifact provenance is not restorable/);
  });
});

test("control-plane restore validation fails missing retained render evidence", async () => {
  await runInTemp("deployment-control-plane-restore-retained-evidence", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    await fsp.mkdir(path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(recordsRoot, "control-plane", "current-stage-state", "demoapp", "dev.json"),
      JSON.stringify(
        {
          schemaVersion: "deployment-current-stage-state@1",
          deploymentId: "demoapp",
          deploymentLabel: "//demo:deploy",
          environmentStage: "dev",
          providerTargetIdentity: "nixos-shared-host:default:demo",
          currentRunId: "restore-current",
          operationKind: "deploy",
          sourceRevision: "rev-restore-1",
          artifactIdentity: "artifact-restore-1",
          artifactReuseMode: "same_artifact",
          finalOutcome: "succeeded",
          updatedAt: "2026-05-12T12:00:00.000Z",
          requiredChecks: [],
          retainedRenderEvidence: [],
          driftStatus: { state: "not_checked" },
        },
        null,
        2,
      ) + "\n",
    );
    const status = await runDeploymentControlPlaneRestoreTest({
      recordsRoot,
      backupRoot: path.join(tmp, "backups"),
      restoreRoot: path.join(tmp, "restore"),
      protectionClass: "shared_nonprod",
    });
    assert.equal(status.latestRestoreTest?.status, "failed");
    assert.match(status.latestRestoreTest?.error || "", /missing retainedRenderEvidence/);
  });
});
