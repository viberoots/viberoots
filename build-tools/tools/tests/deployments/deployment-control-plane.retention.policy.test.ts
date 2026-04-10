#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  assertProtectedSharedDeletionAllowed,
  inspectProtectedSharedRetention,
} from "../../deployments/deployment-control-plane-retention.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("protected/shared retention blocks early deletion and allows post-window cleanup", async () => {
  await runInTemp("deployment-control-plane-retention-policy", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const record = result.record;
      const replaySnapshot = JSON.parse(
        await fsp.readFile(record.replaySnapshotPath || "", "utf8"),
      ) as {
        createdAt: string;
        artifact?: { identity: string; storedArtifactPath?: string; provenancePath?: string };
        publishInput:
          | {
              kind: "exact-artifact";
              artifact: { identity: string; storedArtifactPath?: string; provenancePath?: string };
            }
          | {
              kind: "component-artifacts";
              components: Array<{
                artifact: {
                  identity: string;
                  storedArtifactPath?: string;
                  provenancePath?: string;
                };
              }>;
            };
        platformStateSnapshotPath: string;
        hostConfigSnapshotPath: string;
        controlPlaneExecutionSnapshotPath?: string;
        provisionerPlan?: { artifactPath?: string };
        admittedContext?: { policyEvaluation?: object };
      };
      const artifacts =
        replaySnapshot.publishInput.kind === "component-artifacts"
          ? replaySnapshot.publishInput.components.map(({ artifact }) => artifact)
          : [replaySnapshot.publishInput.artifact];
      const current = await inspectProtectedSharedRetention({
        protectionClass: "shared_nonprod",
        deployRunId: record.deployRunId,
        recordPath: result.recordPath,
        replaySnapshotPath: record.replaySnapshotPath || "",
        replayCreatedAt: replaySnapshot.createdAt,
        artifacts,
        replayBundlePaths: [
          replaySnapshot.platformStateSnapshotPath,
          replaySnapshot.hostConfigSnapshotPath,
          replaySnapshot.controlPlaneExecutionSnapshotPath || "",
          replaySnapshot.provisionerPlan?.artifactPath || "",
        ],
        evidence: replaySnapshot.admittedContext?.policyEvaluation as any,
      });
      assert.equal(current.replayUsable, true);
      assert.equal(current.deletionAllowed, false);
      await assert.rejects(
        assertProtectedSharedDeletionAllowed({
          protectionClass: "shared_nonprod",
          deployRunId: record.deployRunId,
          recordPath: result.recordPath,
          replaySnapshotPath: record.replaySnapshotPath || "",
          replayCreatedAt: replaySnapshot.createdAt,
          artifacts,
          replayBundlePaths: [
            replaySnapshot.platformStateSnapshotPath,
            replaySnapshot.hostConfigSnapshotPath,
          ],
        }),
        /retention policy blocks deleting/,
      );
      const oldTimestamp = new Date("2025-01-01T00:00:00.000Z");
      for (const artifact of artifacts) {
        const provenancePath = artifact.provenancePath || "";
        const currentProvenance = JSON.parse(await fsp.readFile(provenancePath, "utf8"));
        currentProvenance.admittedAt = oldTimestamp.toISOString();
        await fsp.writeFile(
          provenancePath,
          JSON.stringify(currentProvenance, null, 2) + "\n",
          "utf8",
        );
      }
      await fsp.utimes(result.recordPath, oldTimestamp, oldTimestamp);
      await assert.doesNotReject(
        assertProtectedSharedDeletionAllowed({
          protectionClass: "shared_nonprod",
          deployRunId: record.deployRunId,
          recordPath: result.recordPath,
          replaySnapshotPath: record.replaySnapshotPath || "",
          replayCreatedAt: replaySnapshot.createdAt,
          artifacts,
          replayBundlePaths: [
            replaySnapshot.platformStateSnapshotPath,
            replaySnapshot.hostConfigSnapshotPath,
          ],
          now: new Date("2026-04-08T00:00:00.000Z"),
        }),
      );
    } finally {
      await server.close();
    }
  });
});
