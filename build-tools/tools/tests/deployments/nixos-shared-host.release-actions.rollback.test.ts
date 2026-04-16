#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_SCHEMA } from "../../deployments/deployment-secret-fixture.ts";
import { submitNixosSharedHostControlPlaneRun } from "../../deployments/nixos-shared-host-control-plane.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers.ts";
import {
  deploymentReleaseActionFixture,
  deploymentRequirementFixture,
} from "./deployment-metadata.fixture.ts";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `${html}\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeSecretFixture(filePath: string, contracts: Record<string, unknown>) {
  await fsp.writeFile(
    filePath,
    JSON.stringify({ schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA, contracts }, null, 2) + "\n",
    "utf8",
  );
}

test("routine deploy rejects destructive schema-migration release actions", async () => {
  await runInTemp("nixos-shared-host-release-actions-routine-reject", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
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
    const artifactDir = path.join(tmp, "artifact-v2");
    const fixturePath = path.join(tmp, "secret-fixture.json");
    await writeArtifact(artifactDir, "<html>v2</html>");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeSecretFixture(fixturePath, {
      "secret://deployments/demoapp/database_url": {
        value: "postgres://demoapp:test@db.internal/demoapp",
        allowedSteps: ["release_actions.pre_publish"],
        targetScopes: ["*"],
      },
    });
    await withEnvOverrides(
      {
        BNX_DEPLOYMENT_SECRET_FIXTURE_PATH: fixturePath,
      },
      async () =>
        await assert.rejects(
          submitNixosSharedHostControlPlaneRun({
            workspaceRoot: tmp,
            operationKind: "deploy",
            deployment,
            artifactDir,
            paths: {
              statePath: path.join(tmp, "platform-state.json"),
              hostRoot: path.join(tmp, "host"),
              recordsRoot: path.join(tmp, "records"),
            },
          }),
          /rejects destructive built-in release_actions/,
        ),
    );
  });
});
