#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildS3StaticControlPlaneSnapshot } from "../../deployments/s3-static-control-plane-snapshot";
import {
  executeS3StaticControlPlaneSubmission,
  S3_STATIC_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
} from "../../deployments/s3-static-control-plane";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { runInTemp } from "../lib/test-helpers";
import { reviewedLaneAdmissionEvidenceFixture } from "./deployment-lane-governance.fixture";
import { withEnvOverrides } from "./nixos-shared-host.control-plane.helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { installFakeS3StaticAwsCli } from "./s3-static.fake-aws";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { startS3StaticPublicServer } from "./s3-static.public-server";

async function writeJson(filePath: string, value: Record<string, unknown>) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function executeSnapshot(opts: {
  tmp: string;
  recordsRoot: string;
  provider: string;
  execute: (opts: any) => Promise<unknown>;
  snapshot: Record<string, any>;
}) {
  const submissionPath = path.join(opts.recordsRoot, `${opts.provider}-submission.json`);
  const snapshotPath = path.join(opts.recordsRoot, `${opts.provider}-snapshot.json`);
  await writeJson(snapshotPath, opts.snapshot);
  await writeJson(submissionPath, {
    schemaVersion: "deployment-provider-control-plane-submission@1",
    submissionId: opts.snapshot.submissionId,
    submittedAt: opts.snapshot.submittedAt,
    operationKind: opts.snapshot.operationKind,
    deploymentId: opts.snapshot.deploymentId,
    deploymentLabel: opts.snapshot.deploymentLabel,
    providerTargetIdentity: opts.snapshot.providerTargetIdentity,
    lockScope: opts.snapshot.lockScope,
    executionSnapshotPath: snapshotPath,
    lifecycleState: "queued",
    terminationReason: null,
    dedupe: { mode: "created", requestFingerprint: opts.provider },
    admission: opts.snapshot.admission,
  });
  await opts.execute({
    workspaceRoot: opts.tmp,
    recordsRoot: opts.recordsRoot,
    backend: {
      recordsRoot: opts.recordsRoot,
      databaseUrl: localHarnessControlPlaneDatabaseUrl(opts.recordsRoot),
    },
    submissionPath,
    submissionRef: submissionPath,
    executionSnapshotPath: snapshotPath,
    executionSnapshotRef: snapshotPath,
    workerId: `${opts.provider}-worker`,
  });
  return JSON.parse(await fsp.readFile(submissionPath, "utf8"));
}

async function writeStaticArtifact(root: string, html: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
  return root;
}

async function writeS3Config(tmp: string) {
  const configDir = path.join(tmp, "projects", "deployments", "pleomino-staging-s3");
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
    const deployment = s3StaticDeploymentFixture();
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
        },
        async () => {
          const deployArtifact = await writeStaticArtifact(path.join(tmp, "s3-artifact"), "s3\n");
          const deploy = await buildS3StaticControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
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
          await fsp.rm(deployArtifact, { recursive: true, force: true });
          const deployed = await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "s3-deploy",
            execute: executeS3StaticControlPlaneSubmission,
            snapshot: deploy,
          });
          assert.equal(deployed.finalOutcome, "succeeded");
          const retry = await buildS3StaticControlPlaneSnapshot({
            workspaceRoot: tmp,
            recordsRoot,
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
          const replayed = await executeSnapshot({
            tmp,
            recordsRoot,
            provider: "s3-retry",
            execute: executeS3StaticControlPlaneSubmission,
            snapshot: retry,
          });
          assert.equal(replayed.finalOutcome, "succeeded");
        },
      );
    } finally {
      await server.close();
    }
  });
});
