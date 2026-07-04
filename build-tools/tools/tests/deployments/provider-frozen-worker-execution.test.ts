#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildS3StaticControlPlaneSnapshot } from "../../deployments/s3-static-control-plane-snapshot";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import {
  executeS3StaticControlPlaneSubmission,
  S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/s3-static-control-plane";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import {
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { installFakeS3StaticAwsCli } from "./s3-static.fake-aws";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { startS3StaticPublicServer } from "./s3-static.public-server";
import { executeFrozenProviderSnapshotAndReadSubmission } from "./provider-frozen-worker.helpers";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";

async function writeStaticArtifact(root: string, html: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  return root;
}

async function writeS3Config(tmp: string) {
  const configDir = path.join(tmp, "projects", "deployments", "sample-webapp", "staging-s3");
  await fsp.mkdir(configDir, { recursive: true });
  await fsp.writeFile(
    path.join(configDir, "aws-s3-sync.jsonc"),
    '{ "distribution": "staging.example.test" }\n',
    "utf8",
  );
}

test("s3-static worker deploy and retry execute from frozen snapshots", async () => {
  await runInTemp("provider-frozen-s3-worker-execution", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    const infisical = await startFakeInfisicalServer(
      [
        { clientId: "id", clientSecret: "server-local-secret", accessToken: "admission-token" },
        { clientId: "s3-worker", clientSecret: "server-local-secret", accessToken: "token" },
      ],
      [infisicalSecret({ secretName: "s3_publish_token", secretValue: "s3-secret" })],
    );
    const deployment = {
      ...s3StaticDeploymentFixture({
        secretRequirements: ["publish", "smoke"].map((step) =>
          deploymentRequirementFixture({
            name: "s3_publish_token",
            step: step as "publish" | "smoke",
            contractId: "secret://deployments/sample-webapp/s3_publish_token",
          }),
        ),
      }),
      secretBackend: "infisical" as const,
      infisicalRuntime: {
        ...infisicalRuntime,
        siteUrl: infisical.siteUrl,
        preferredCredentialSource: "machine_identity_universal_auth" as const,
        machineIdentityClientIdEnv: "VBR_S3_INFISICAL_CLIENT_ID",
        machineIdentityClientSecretEnv: "VBR_S3_INFISICAL_CLIENT_SECRET",
      },
    };
    const fake = await installFakeS3StaticAwsCli(tmp);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await writeS3Config(tmp);
    const server = await startS3StaticPublicServer({
      deployment,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const smokeConnectOverride = {
      protocol: "https:" as const,
      hostname: "127.0.0.1",
      port: server.port,
      rejectUnauthorized: false,
    };
    try {
      await withEnvOverrides(
        {
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_S3_STATIC_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_S3_STATIC_FAKE_AWS_LOG: fake.logPath,
          VBR_S3_STATIC_AWS_BIN: path.join(fake.binDir, "aws"),
          VBR_S3_INFISICAL_CLIENT_ID: "s3-worker",
          VBR_S3_INFISICAL_CLIENT_SECRET: "server-local-secret",
        },
        async () => {
          const objectStore = memoryControlPlaneArtifactStore();
          const deployArtifact = await writeStaticArtifact(path.join(tmp, "s3-artifact"), "s3\n");
          const restoreDeployAdmissionContext = activateDeploymentSecretContext(
            infisicalTestContext(infisical.siteUrl, { clientSecret: "server-local-secret" }),
          );
          let deploy: Awaited<ReturnType<typeof buildS3StaticControlPlaneSnapshot>>;
          try {
            deploy = await buildS3StaticControlPlaneSnapshot({
              workspaceRoot: tmp,
              recordsRoot,
              objectStore,
              request: {
                schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
                submissionId: "s3-worker-deploy",
                submittedAt: new Date().toISOString(),
                deployment,
                operationKind: "deploy",
                artifactDir: deployArtifact,
                admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
                smokeConnectOverride,
              },
            });
          } finally {
            restoreDeployAdmissionContext();
          }
          await fsp.rm(deployArtifact, { recursive: true, force: true });
          const deployed = await executeFrozenProviderSnapshotAndReadSubmission({
            tmp,
            recordsRoot,
            provider: "s3-deploy",
            execute: executeS3StaticControlPlaneSubmission,
            snapshot: deploy,
            objectStore,
          });
          assert.equal(deployed.finalOutcome, "succeeded");
          const deployRecord = JSON.parse(await fsp.readFile(deployed.resultRecordPath, "utf8"));
          assert.ok(deployRecord.artifact.object);
          assert.match(deployRecord.artifact.storedArtifactPath, /^artifact-object:\/\//);
          const deployReplay = JSON.parse(
            await fsp.readFile(deployRecord.replaySnapshotPath, "utf8"),
          );
          assert.ok(deployReplay.artifact.object);
          assert.match(deployReplay.artifact.storedArtifactPath, /^artifact-object:\/\//);
          const restoreRetryAdmissionContext = activateDeploymentSecretContext(
            infisicalTestContext(infisical.siteUrl, { clientSecret: "server-local-secret" }),
          );
          let retry: Awaited<ReturnType<typeof buildS3StaticControlPlaneSnapshot>>;
          try {
            retry = await buildS3StaticControlPlaneSnapshot({
              workspaceRoot: tmp,
              recordsRoot,
              objectStore,
              request: {
                schemaVersion: S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
                submissionId: "s3-worker-retry",
                submittedAt: new Date().toISOString(),
                deployment,
                operationKind: "retry",
                sourceRunId: deployed.deployRunId,
                admissionEvidence: reviewedLaneAdmissionEvidenceFixture({ deployment }),
                smokeConnectOverride,
              },
            });
          } finally {
            restoreRetryAdmissionContext();
          }
          const replayed = await executeFrozenProviderSnapshotAndReadSubmission({
            tmp,
            recordsRoot,
            provider: "s3-retry",
            execute: executeS3StaticControlPlaneSubmission,
            snapshot: retry,
            objectStore,
          });
          assert.equal(replayed.finalOutcome, "succeeded");
        },
      );
    } finally {
      await server.close();
      await infisical.close();
    }
  });
});
