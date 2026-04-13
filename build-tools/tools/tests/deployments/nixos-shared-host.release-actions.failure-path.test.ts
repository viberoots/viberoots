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
import { submitNixosSharedHostPublishOnlyRun } from "../../deployments/nixos-shared-host-publish-only.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  readLatestRunRecord,
  releaseActionDeployment,
  releaseActionMarkers,
} from "./nixos-shared-host.release-actions.helpers.ts";

test("nixos-shared-host success path skips failure_only release actions", async () => {
  await runInTemp("nixos-shared-host-release-actions-success-path", async (tmp, $) => {
    const deployment = releaseActionDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const result = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: {
          statePath: path.join(tmp, "platform-state.json"),
          hostRoot,
          recordsRoot,
        },
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision: "rev-success-path",
          artifactIdentity: "artifact-success-path",
          artifactLineageId: "artifact-success-path",
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: server.port,
          rejectUnauthorized: false,
        },
      });
      assert.deepEqual(await releaseActionMarkers(recordsRoot, result.record.deployRunId), [
        "post_publish_pre_smoke.demoapp-shared_publish_always_marker.json",
        "post_smoke.demoapp-shared_always_marker.json",
        "post_smoke.demoapp-shared_success_marker.json",
      ]);
    } finally {
      await server.close();
    }
  });
});

test("nixos-shared-host publish failure runs failure_only release actions and keeps canonical failure record", async () => {
  await runInTemp("nixos-shared-host-release-actions-publish-failure", async (tmp, $) => {
    const deployment = releaseActionDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const backendDatabaseUrl = localHarnessControlPlaneDatabaseUrl(recordsRoot);
    await writeDemoArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const sourceServer = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const source = await submitNixosSharedHostControlPlaneRun({
        workspaceRoot: tmp,
        operationKind: "deploy",
        deployment,
        artifactDir,
        paths: { statePath, hostRoot, recordsRoot },
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment,
          operationKind: "deploy",
          sourceRevision: "rev-publish-source",
          artifactIdentity: "artifact-publish-source",
          artifactLineageId: "artifact-publish-source",
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: sourceServer.port,
          rejectUnauthorized: false,
        },
      });
      await syncBackendDeployRecord(
        { recordsRoot, databaseUrl: backendDatabaseUrl },
        source.recordPath,
      );
      await fsp.rm(hostRoot, { recursive: true, force: true });
      await assert.rejects(
        submitNixosSharedHostPublishOnlyRun({
          workspaceRoot: tmp,
          deployment,
          sourceRunId: source.record.deployRunId,
          rollback: false,
          backendDatabaseUrl,
          paths: { statePath, hostRoot, recordsRoot },
          admissionEvidence: deploymentAdmissionEvidenceFixture({
            deployment,
            operationKind: "retry",
            sourceRevision: "rev-publish-retry",
            sourceRunId: source.record.deployRunId,
            artifactIdentity: source.record.artifact!.identity,
            artifactLineageId: source.record.artifactLineageId,
          }),
        }),
        (error: any) => {
          assert.equal(error.record.failedStep, "publish");
          assert.equal(error.record.finalOutcome, "publish_failed");
          assert.match(error.message, /missing required runtime path/);
          return true;
        },
      );
      const latestRecord = await readLatestRunRecord(recordsRoot);
      assert.deepEqual(await releaseActionMarkers(recordsRoot, latestRecord.deployRunId), [
        "post_publish_pre_smoke.demoapp-shared_publish_always_marker.json",
        "post_publish_pre_smoke.demoapp-shared_publish_failure_cleanup.json",
      ]);
    } finally {
      await sourceServer.close();
    }
  });
});

test("nixos-shared-host smoke failure runs failure_only post_smoke actions and preserves smoke failure semantics", async () => {
  await runInTemp("nixos-shared-host-release-actions-smoke-failure", async (tmp, $) => {
    const deployment = releaseActionDeployment();
    const artifactDir = path.join(tmp, "artifact");
    const wrongRoot = path.join(tmp, "wrong-root");
    const hostRoot = path.join(tmp, "host");
    const recordsRoot = path.join(tmp, "records");
    await writeDemoArtifact(artifactDir, "expected");
    await writeDemoArtifact(wrongRoot, "wrong");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, fixedRoot: wrongRoot });
    try {
      await assert.rejects(
        submitNixosSharedHostControlPlaneRun({
          workspaceRoot: tmp,
          operationKind: "deploy",
          deployment,
          artifactDir,
          paths: {
            statePath: path.join(tmp, "platform-state.json"),
            hostRoot,
            recordsRoot,
          },
          admissionEvidence: deploymentAdmissionEvidenceFixture({
            deployment,
            operationKind: "deploy",
            sourceRevision: "rev-smoke-failure",
            artifactIdentity: "artifact-smoke-failure",
            artifactLineageId: "artifact-smoke-failure",
          }),
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        }),
        (error: any) => {
          assert.equal(error.record.failedStep, "smoke");
          assert.equal(error.record.finalOutcome, "smoke_failed_after_publish");
          return true;
        },
      );
      const latestRecord = await readLatestRunRecord(recordsRoot);
      assert.deepEqual(await releaseActionMarkers(recordsRoot, latestRecord.deployRunId), [
        "post_publish_pre_smoke.demoapp-shared_publish_always_marker.json",
        "post_smoke.demoapp-shared_always_marker.json",
        "post_smoke.demoapp-shared_failure_marker.json",
      ]);
    } finally {
      await server.close();
    }
  });
});
