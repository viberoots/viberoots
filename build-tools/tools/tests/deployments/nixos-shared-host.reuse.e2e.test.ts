#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import {
  liveIndexPath,
  writeAdmissionEvidenceJson,
  writeArtifact,
  writeDeploymentJson,
} from "./nixos-shared-host.reuse.e2e.helpers.ts";

test("nixos-shared-host publish-only rejects ambiguous replay selectors and implicit rebuild inputs", async () => {
  await runInTemp("nixos-shared-host-reuse-rejects", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const otherArtifactDir = path.join(tmp, "other-artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const commandEnv = {
      ...process.env,
      BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    await writeArtifact(artifactDir, "v1");
    await writeArtifact(otherArtifactDir, "v2");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const first = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await assert.rejects(
        $({
          cwd: tmp,
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot}`,
        /shared --publish-only requires --source-run-id/,
      );
      await assert.rejects(
        $({
          cwd: tmp,
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --rollback --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot}`,
        /shared rollback requires --source-run-id/,
      );
      await assert.rejects(
        $({
          cwd: tmp,
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --artifact-dir ${otherArtifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot}`,
        /must not use --artifact-dir/,
      );
    } finally {
      await server.close();
    }
  });
});
test("nixos-shared-host publish-only retry reuses the stored exact artifact from a failed run", async () => {
  await runInTemp("nixos-shared-host-retry-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const wrongRoot = path.join(tmp, "wrong-root");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const commandEnv = {
      ...process.env,
      BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    await writeArtifact(artifactDir, "v1");
    await writeArtifact(wrongRoot, "wrong");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const wrongServer = await startNixosSharedHostPublicServer({
      deployment,
      fixedRoot: wrongRoot,
    });
    try {
      await assert.rejects(
        $({
          cwd: tmp,
        })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(wrongServer.port)} --smoke-connect-protocol https:`,
        /smoke content mismatch/,
      );
    } finally {
      await wrongServer.close();
    }
    const [failedRecordName] = (await fsp.readdir(path.join(recordsRoot, "runs"))).sort();
    const failedRecordPath = path.join(recordsRoot, "runs", failedRecordName);
    const failedRecord = JSON.parse(await fsp.readFile(failedRecordPath, "utf8"));
    const goodServer = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const retry = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${failedRecord.deployRunId} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(goodServer.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(retry.stdout));
      assert.equal(summary.operationKind, "retry");
      assert.equal(summary.runClassification, "retry");
      assert.equal(summary.parentRunId, failedRecord.deployRunId);
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.operationKind, "retry");
      assert.equal(record.parentRunId, failedRecord.deployRunId);
      assert.equal(record.artifact.identity, failedRecord.artifact.identity);
      assert.equal(record.artifactLineageId, failedRecord.artifactLineageId);
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.operationKind, "retry");
      assert.equal(snapshot.action.publishBehavior, "publish-only");
      assert.equal(snapshot.action.parentRunId, failedRecord.deployRunId);
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v1/);
    } finally {
      await goodServer.close();
    }
  });
});
test("nixos-shared-host publish-only can republish a retained exact artifact without rebuilding", async () => {
  await runInTemp("nixos-shared-host-publish-only-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    const commandEnv = {
      ...process.env,
      BNX_DEPLOY_CONTROL_PLANE_DATABASE_URL: localHarnessControlPlaneDatabaseUrl(recordsRoot),
    };
    await writeArtifact(artifactDir, "v1");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const first = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const republish = await $({
        cwd: tmp,
        env: commandEnv,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(republish.stdout));
      assert.equal(summary.operationKind, "retry");
      assert.equal(summary.runClassification, "retry");
      assert.equal(summary.artifactIdentity, firstSummary.artifactIdentity);
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.parentRunId, firstSummary.deployRunId);
      assert.equal(record.artifact.identity, firstSummary.artifactIdentity);
      assert.equal(record.artifactLineageId, firstSummary.artifactIdentity);
    } finally {
      await server.close();
    }
  });
});
test("nixos-shared-host reuses a live exact artifact on a second deploy instead of republishing", async () => {
  await runInTemp("nixos-shared-host-live-reuse", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir, "v1");
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentJson,
      deployment,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const second = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment-json ${deploymentJson} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(second.stdout));
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.componentResults[0].publishState.mode, "reused_live_identity");
      assert.equal(
        record.componentResults[0].publishState.liveArtifactIdentity,
        record.artifact.identity,
      );
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v1/);
    } finally {
      await server.close();
    }
  });
});
