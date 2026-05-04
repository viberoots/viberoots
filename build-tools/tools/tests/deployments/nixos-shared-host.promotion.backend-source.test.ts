#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentPromotionSource } from "../../deployments/deployment-promotion";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendDeployRecord,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function writeArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>promotion source</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("shared-host promotion source lookup resolves from backend when the run mirror is absent", async () => {
  await runInTemp("nixos-shared-host-promotion-backend-source", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
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
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision: "rev-promotion-source-1",
          artifactIdentity: "artifact-promotion-source-1",
          artifactLineageId: "artifact-promotion-source-1",
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      await syncBackendDeployRecord(
        { recordsRoot, databaseUrl: backendDatabaseUrl },
        result.recordPath,
      );
      await fsp.rm(result.recordPath, { force: true });

      const source = await resolveDeploymentPromotionSource({
        workspaceRoot: tmp,
        recordsRoot,
        sourceRunId: result.record.deployRunId,
        backendDatabaseUrl,
      });

      assert.equal(source.record.deployRunId, result.record.deployRunId);
      assert.equal(source.record.provider, "nixos-shared-host");
      assert.equal(await fsp.stat(result.recordPath).catch(() => null), null);
      assert.equal(source.replaySnapshot.deployRunId, result.record.deployRunId);
      assert.equal("recordPath" in source, false);
    } finally {
      await server.close();
    }
  });
});
