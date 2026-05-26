#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { providerCapabilityFor } from "../../deployments/deployment-provider-capabilities";
import { reviewedRuntimeContractFor } from "../../deployments/provider-capabilities/runtime-contract";
import { assertReviewedRuntimeParity } from "../../deployments/provider-capabilities/runtime-parity";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  startControlPlaneHarness,
  withEnvOverrides,
} from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { installHarnessClientProfile } from "./nixos-shared-host.remote-exec.install.helpers";
import { installFakeS3StaticAwsCli } from "./s3-static.fake-aws";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture";
import { startS3StaticPublicServer } from "./s3-static.public-server";

async function writeArtifact(root: string, html: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

function fakeAwsOverrides(fake: Awaited<ReturnType<typeof installFakeS3StaticAwsCli>>) {
  return {
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_S3_STATIC_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_S3_STATIC_FAKE_AWS_LOG: fake.logPath,
    VBR_S3_STATIC_AWS_BIN: path.join(fake.binDir, "aws"),
  };
}

function assertProtectedSharedControlPlaneRecord(
  record: { controlPlane?: { lockScope: string }; finalOutcome: string },
  lockScope: string,
) {
  assert.ok(record.controlPlane);
  assert.equal(record.controlPlane.lockScope, lockScope);
  assert.equal(record.finalOutcome, "succeeded");
}

test("public s3-static deploy requires a control-plane URL for protected/shared targets", async () => {
  await runInTemp("s3-static-public-service-required", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir, "<html>service-required</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
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
      /s3-static (shared_nonprod|production_facing) mutation requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL/,
    );
  });
});

test("public s3-static deploy routes deploy, provision-only, retry, and rollback through the control-plane service", async () => {
  await runInTemp("s3-static-public-service-flow", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture({
      lanePolicy: nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" }),
      provisioner: { type: "terraform-stack" },
    });
    const artifactA = path.join(tmp, "artifact-a");
    const artifactB = path.join(tmp, "artifact-b");
    const fake = await installFakeS3StaticAwsCli(tmp);
    await writeArtifact(artifactA, "<html>a</html>\n");
    await writeArtifact(artifactB, "<html>b</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "pleomino", "staging-s3"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmp, "projects", "deployments", "pleomino", "staging-s3", "aws-s3-sync.jsonc"),
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
          const profileRoot = await installHarnessClientProfile($, tmp, harness.controlPlane.url);
          const runtimeContract = reviewedRuntimeContractFor("s3-static");
          const lockScope = deployment.providerTarget.providerTargetIdentity;
          const clientEnv = {
            ...process.env,
            VBR_DEPLOY_CONTROL_PLANE_TOKEN: "test-control-plane-token",
          };
          const first = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: clientEnv,
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactA} --admission-evidence-json ${evidence} --profile-root ${profileRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`
              ).stdout,
            ),
          );
          assert.equal(first.finalOutcome, "succeeded");
          assert.equal("recordPath" in first, false);
          const firstRecord = first;
          const provisionOnly = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: clientEnv,
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --provision-only --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`
              ).stdout,
            ),
          );
          assert.equal(provisionOnly.finalOutcome, "succeeded");
          const provisionOnlyRecord = provisionOnly;
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
          assert.equal(second.finalOutcome, "succeeded");
          const retry = JSON.parse(
            String(
              (
                await $({
                  cwd: tmp,
                  stdio: "pipe",
                  env: { ...process.env },
                })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --publish-only --source-run-id ${first.deployRunId} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`
              ).stdout,
            ),
          );
          assert.equal(retry.finalOutcome, "succeeded");
          const retryRecord = retry;
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
          const rollbackRecord = rollback;
          assert.equal(firstRecord.provider, "s3-static");
          assert.equal(firstRecord.runClassification, "deploy");
          assert.equal(
            provisionOnlyRecord.runClassification,
            runtimeContract.provisionOnlyClassification,
          );
          assert.equal(
            retryRecord.runClassification,
            runtimeContract.sameDeploymentPublishOnlyClassification,
          );
          assert.equal(
            retryRecord.operationKind,
            runtimeContract.sameDeploymentPublishOnlyClassification,
          );
          assert.equal(retryRecord.parentRunId, first.deployRunId);
          assert.equal(retryRecord.releaseLineageId, first.deployRunId);
          assert.equal(retryRecord.artifactLineageId, firstRecord.artifact?.identity);
          assert.equal(rollbackRecord.runClassification, runtimeContract.rollbackClassification);
          assert.equal(rollbackRecord.operationKind, runtimeContract.rollbackClassification);
          assert.equal(rollbackRecord.parentRunId, first.deployRunId);
          assert.equal(rollbackRecord.releaseLineageId, first.deployRunId);
          assert.equal(rollbackRecord.artifactLineageId, firstRecord.artifact?.identity);
          if (runtimeContract.protectedSharedRequiresControlPlane) {
            for (const record of [firstRecord, provisionOnlyRecord, retryRecord, rollbackRecord]) {
              assertProtectedSharedControlPlaneRecord(record, lockScope);
            }
          }
          const capability = providerCapabilityFor("s3-static");
          assert.ok(capability);
          assertReviewedRuntimeParity({ provider: "s3-static", capability });
        } finally {
          await harness.close();
        }
      });
    } finally {
      await server.close();
    }
  });
});
