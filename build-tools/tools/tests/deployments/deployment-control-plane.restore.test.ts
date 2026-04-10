#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  readDeploymentControlPlaneResilienceStatus,
  runDeploymentControlPlaneRestoreTest,
} from "../../deployments/deployment-control-plane-resilience.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

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
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
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
      const status = await runDeploymentControlPlaneRestoreTest({
        recordsRoot,
        backupRoot: path.join(tmp, "backups"),
        restoreRoot: path.join(tmp, "restore"),
        protectionClass: "shared_nonprod",
      });
      assert.equal(status.latestRestoreTest?.status, "passed");
      assert.ok((status.latestRestoreTest?.restoredRunCount || 0) >= 1);
      assert.ok((status.latestRestoreTest?.restoredSubmissionCount || 0) >= 1);
      const persisted = await readDeploymentControlPlaneResilienceStatus(recordsRoot);
      assert.equal(persisted?.schemaVersion, "deployment-control-plane-resilience-status@1");
      assert.equal(persisted?.latestRestoreTest?.status, "passed");
    } finally {
      await server.close();
    }
  });
});
