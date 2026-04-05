#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { resolveNixosSharedHostReplaySelection } from "../../deployments/nixos-shared-host-replay.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  deploymentReleaseActionFixture,
  deploymentRequirementFixture,
} from "./deployment-metadata.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `${html}\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("rollback rejects older source runs when the current live run applied a forward-only release action", async () => {
  await runInTemp("nixos-shared-host-release-actions-rollback", async (tmp, $) => {
    const baseDeployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const guardedDeployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
      secretRequirements: [
        deploymentRequirementFixture({
          name: "database_url",
          contractId: "secret://deployments/demoapp/database_url",
        }),
      ],
      runtimeConfigRequirements: [
        deploymentRequirementFixture({
          name: "schema_version",
          contractId: "config://deployments/demoapp/schema_version",
        }),
      ],
      releaseActions: [
        deploymentReleaseActionFixture({
          dataCompatibility: "forward_only",
          replayPolicy: {
            deploy_publish_slice: "skip",
            retry: "rerun",
            rollback: "fail",
            promotion: "skip",
          },
        }),
      ],
    });
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    const firstArtifact = path.join(tmp, "artifact-v1");
    const secondArtifact = path.join(tmp, "artifact-v2");
    await writeArtifact(firstArtifact, "<html>v1</html>");
    await writeArtifact(secondArtifact, "<html>v2</html>");
    await ensureNixosSharedHostStageBranch(tmp, $, baseDeployment);
    const server = await startNixosSharedHostPublicServer({ deployment: baseDeployment, hostRoot });
    try {
      const firstRun = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment: baseDeployment,
        artifactDir: firstArtifact,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment: guardedDeployment,
        artifactDir: secondArtifact,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      await assert.rejects(
        resolveNixosSharedHostReplaySelection({
          deployment: guardedDeployment,
          recordsRoot,
          sourceRunId: firstRun.record.deployRunId,
          rollback: true,
        }),
        /blocked by current release-action posture/,
      );
    } finally {
      await server.close();
    }
  });
});
