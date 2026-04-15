#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture.ts";
import {
  readRecord,
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { installFakeS3StaticAwsCli } from "./s3-static.fake-aws.ts";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture.ts";
import { startS3StaticPublicServer } from "./s3-static.public-server.ts";

async function writeArtifact(root: string, html: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

function fakeAwsOverrides(fake: Awaited<ReturnType<typeof installFakeS3StaticAwsCli>>) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    BNX_S3_STATIC_FAKE_PUBLISH_ROOT: fake.publishRoot,
    BNX_S3_STATIC_FAKE_AWS_LOG: fake.logPath,
    BNX_S3_STATIC_AWS_BIN: path.join(fake.binDir, "aws"),
  };
}

test("public s3-static deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("s3-static-public-service-required", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir, "<html>service-required</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    await assert.rejects(
      $({
        cwd: tmp,
        stdio: "pipe",
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${evidence}`,
      /s3-static (shared_nonprod|production_facing) mutation requires --control-plane-url or BNX_DEPLOY_CONTROL_PLANE_URL/,
    );
  });
});

test("public s3-static deploy routes deploy, provision-only, and rollback through the control-plane service", async () => {
  await runInTemp("s3-static-public-service-flow", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture({ provisioner: { type: "terraform-stack" } });
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const fake = await installFakeS3StaticAwsCli(tmp);
    await writeArtifact(artifactA, "<html>a</html>\n");
    await writeArtifact(artifactB, "<html>b</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "pleomino-staging-s3"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmp, "projects", "deployments", "pleomino-staging-s3", "aws-s3-sync.jsonc"),
      '{\n  "distribution": "staging.example.test"\n}\n',
      "utf8",
    );
    const evidence = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const server = await startS3StaticPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    try {
      await withEnvOverrides(fakeAwsOverrides(fake), async () => {
        const harness = await startControlPlaneHarness({
          workspaceRoot: tmp,
          hostRoot: path.join(tmp, "host"),
          recordsRoot: path.join(tmp, "records"),
        });
        try {
          const first = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactA} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`
              ).stdout,
            ),
          );
          assert.equal(first.finalOutcome, "succeeded");
          assert.equal("recordPath" in first, false);
          const provisionOnly = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --provision-only --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`
              ).stdout,
            ),
          );
          assert.equal(provisionOnly.finalOutcome, "succeeded");
          const second = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactB} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`
              ).stdout,
            ),
          );
          const rollback = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --publish-only --rollback --source-run-id ${first.deployRunId} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`
              ).stdout,
            ),
          );
          assert.equal(rollback.finalOutcome, "succeeded");
          const record = await readRecord(harness.controlPlane.url, second.deployRunId);
          assert.equal(record.provider, "s3-static");
        } finally {
          await harness.close();
        }
      });
    } finally {
      await server.close();
    }
  });
});
