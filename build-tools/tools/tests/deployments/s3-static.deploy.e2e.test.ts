#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture";
import { installFakeS3StaticAwsCli } from "./s3-static.fake-aws";
import { startS3StaticPublicServer } from "./s3-static.public-server";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

test("s3-static deploy CLI completes the static-webapp flow end to end", async () => {
  await runInTemp("s3-static-e2e", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture({ provisioner: { type: "terraform-stack" } });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeS3StaticAwsCli(tmp);
    await writeArtifact(artifactDir, "<html>pleomino s3 staging</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "pleomino-staging-s3"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmp, "projects", "deployments", "pleomino-staging-s3", "aws-s3-sync.jsonc"),
      '{\n  "delete": true,\n  "distribution": "staging.example.test"\n}\n',
      "utf8",
    );
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
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
      const result = await $({
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fake.binDir}:${process.env.PATH || ""}`,
          VBR_S3_STATIC_FAKE_PUBLISH_ROOT: fake.publishRoot,
          VBR_S3_STATIC_FAKE_AWS_LOG: fake.logPath,
          VBR_S3_STATIC_AWS_BIN: path.join(fake.binDir, "aws"),
        },
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://staging.example.test/");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.provider, "s3-static");
      assert.equal(record.providerReleaseId, "s3-sync-01TEST");
      assert.equal(record.runnerIdentities.publisher, deployment.publisher.type);
      assert.equal(record.runnerIdentities.provisioner, "terraform-stack");
      assert.equal(record.runnerIdentities.smoke, "s3-static-static-webapp-smoke@1");
      assert.equal(record.provisionerType, "terraform-stack");
      assert.ok(record.provisionerPlan?.artifactPath);
    } finally {
      await server.close();
    }
  });
});

test("s3-static fails closed on ambiguous publish results", async () => {
  await runInTemp("s3-static-ambiguous", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeS3StaticAwsCli(tmp);
    await writeArtifact(artifactDir, "<html>ambiguous</html>\n");
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await fsp.mkdir(path.join(tmp, "projects", "deployments", "pleomino-staging-s3"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(tmp, "projects", "deployments", "pleomino-staging-s3", "aws-s3-sync.jsonc"),
      "{}\n",
      "utf8",
    );
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "1111111111111111111111111111111111111111",
      artifactIdentity: "artifact-ambiguous",
      artifactLineageId: "artifact-ambiguous",
    });
    process.env.PATH = `${fake.binDir}:${process.env.PATH || ""}`;
    process.env.VBR_S3_STATIC_FAKE_PUBLISH_ROOT = fake.publishRoot;
    process.env.VBR_S3_STATIC_FAKE_AWS_LOG = fake.logPath;
    process.env.VBR_S3_STATIC_AWS_BIN = path.join(fake.binDir, "aws");
    process.env.VBR_S3_STATIC_FAKE_AMBIGUOUS_RESULT = "1";
    try {
      await assert.rejects(
        async () =>
          await import("../../deployments/s3-static-deploy").then(({ submitS3StaticDeploy }) =>
            submitS3StaticDeploy({
              workspaceRoot: tmp,
              deployment,
              artifactDir,
              recordsRoot,
              admissionEvidence,
            }),
          ),
        /ambiguous publish result/,
      );
    } finally {
      delete process.env.VBR_S3_STATIC_FAKE_PUBLISH_ROOT;
      delete process.env.VBR_S3_STATIC_FAKE_AWS_LOG;
      delete process.env.VBR_S3_STATIC_AWS_BIN;
      delete process.env.VBR_S3_STATIC_FAKE_AMBIGUOUS_RESULT;
    }
  });
});
