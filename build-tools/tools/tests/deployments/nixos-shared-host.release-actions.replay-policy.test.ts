#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import { deploymentReleaseActionFixture } from "./deployment-metadata.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

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
      releaseActions: [
        deploymentReleaseActionFixture({
          ref: "//projects/deployments/demoapp-shared:post_publish_verification",
          type: "post_publish_verification",
          phase: "post_publish_pre_smoke",
          dataCompatibility: "reversible",
          replayPolicy: {
            deploy_publish_slice: "skip",
            retry: "rerun",
            rollback: "fail",
            promotion: "skip",
          },
          requiredSecretRequirementNames: [],
          requiredRuntimeConfigRequirementNames: [],
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
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    await withEnvOverrides(
      {
        BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
      },
      async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot,
          statePath,
          recordsRoot,
        });
        const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
        const commandEnv = { ...process.env };
        try {
          const first = await $({
            cwd: tmp,
            env: commandEnv,
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
          const firstSummary = JSON.parse(String(first.stdout));
          const rollback = await $({
            cwd: tmp,
            env: commandEnv,
          })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`.nothrow();
          assert.notEqual(rollback.exitCode, 0);
          assert.match(String(rollback.stderr), /does not permit rollback replay/);
        } finally {
          await harness.close();
          await server.close();
        }
      },
    );
  });
});
