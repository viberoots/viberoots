#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  localHarnessControlPlaneDatabaseUrl,
  syncBackendDeployRecord,
} from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { deploymentTargetExceptionFixture } from "./deployment-metadata.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("replay fails closed when an active migration exception invalidates the recorded target binding", async () => {
  await runInTemp("nixos-shared-host-target-exception-replay", async (tmp, $) => {
    const sourceDeployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const currentDeployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp-next", containerPort: 3000, healthPath: "/healthz" },
      targetExceptions: [
        deploymentTargetExceptionFixture({
          exceptionKind: "migration",
          oldProviderTargetIdentity: sourceDeployment.providerTarget.deploymentTargetIdentity,
          newProviderTargetIdentity: "nixos-shared-host:default:demoapp-next",
          sharedLockScope: "nixos-shared-host:default:demoapp-next",
        }),
      ],
    });
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, sourceDeployment);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment: sourceDeployment,
      operationKind: "deploy",
      sourceRevision: "rev-target-exception-1",
      artifactIdentity: "artifact-target-exception-1",
      artifactLineageId: "artifact-target-exception-1",
    });
    const server = await startNixosSharedHostPublicServer({
      deployment: sourceDeployment,
      hostRoot,
    });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment: sourceDeployment,
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
      await syncBackendDeployRecord(
        { recordsRoot, databaseUrl: backendDatabaseUrl },
        result.recordPath,
      );
      await assert.rejects(
        resolveNixosSharedHostReplaySelection({
          deployment: currentDeployment,
          recordsRoot,
          backendDatabaseUrl,
          sourceRunId: result.record.deployRunId,
          rollback: false,
        }),
        /invalidated by/,
      );
    } finally {
      await server.close();
    }
  });
});
