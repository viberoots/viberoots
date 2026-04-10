#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { resolveNixosSharedHostReplaySource } from "../../deployments/nixos-shared-host-replay.ts";
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

test("replay fails explicitly when the replay bundle is incomplete or the retained window expired", async () => {
  await runInTemp("nixos-shared-host-replay-retention", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-replay-retention-1",
      artifactIdentity: "artifact-replay-retention-1",
      artifactLineageId: "artifact-replay-retention-1",
    });
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
        admissionEvidence,
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      const replay = await resolveNixosSharedHostReplaySource({ recordPath: result.recordPath });
      await fsp.rm(replay.replaySnapshot.platformStateSnapshotPath, { force: true });
      await assert.rejects(
        resolveNixosSharedHostReplaySource({ recordPath: result.recordPath }),
        /replay bundle is incomplete/,
      );
      const artifact =
        replay.replaySnapshot.publishInput.kind === "component-artifacts"
          ? replay.replaySnapshot.publishInput.components[0]!.artifact
          : replay.replaySnapshot.publishInput.artifact;
      const provenance = JSON.parse(await fsp.readFile(artifact.provenancePath, "utf8"));
      provenance.admittedAt = "2025-01-01T00:00:00.000Z";
      await fsp.writeFile(
        artifact.provenancePath,
        JSON.stringify(provenance, null, 2) + "\n",
        "utf8",
      );
      await fsp.writeFile(
        replay.replaySnapshot.platformStateSnapshotPath,
        JSON.stringify({ restored: true }, null, 2) + "\n",
        "utf8",
      );
      await assert.rejects(
        resolveNixosSharedHostReplaySource({ recordPath: result.recordPath }),
        /required retained artifact window expired/,
      );
    } finally {
      await server.close();
    }
  });
});
