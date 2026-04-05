#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
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

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

async function writeDeploymentJson(filePath: string, deployment: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

test("rollback replay fails when the recorded release-action policy forbids rollback rerun", async () => {
  await runInTemp("nixos-shared-host-release-actions-replay-policy", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
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
          dataCompatibility: "reversible",
          replayPolicy: {
            deploy_publish_slice: "skip",
            retry: "rerun",
            rollback: "fail",
            promotion: "skip",
          },
        }),
      ],
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const first = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      const rollback = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
      assert.notEqual(rollback.exitCode, 0);
      assert.match(String(rollback.stderr), /does not permit rollback replay/);
    } finally {
      await server.close();
    }
  });
});
