#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { readRecord, startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  installNixosSharedHostTargets,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";
import {
  liveIndexPath,
  writeAdmissionEvidenceJson,
  writeArtifact,
  writeDeploymentJson,
} from "./nixos-shared-host.reuse.e2e.helpers";

test("nixos-shared-host rollback restores a prior known-good exact artifact", async () => {
  await runInTemp("nixos-shared-host-rollback-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const firstArtifactDir = path.join(tmp, "artifact-v1");
    const secondArtifactDir = path.join(tmp, "artifact-v2");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(firstArtifactDir, "v1");
    await writeArtifact(secondArtifactDir, "v2");
    await installNixosSharedHostTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    await writeDeploymentJson(deploymentJson, deployment);
    const admissionEvidenceJson = await writeAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    try {
      const first = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${firstArtifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const firstSummary = JSON.parse(String(first.stdout));
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${secondArtifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v2/);
      await fsp.rm(firstArtifactDir, { recursive: true, force: true });
      await fsp.rm(secondArtifactDir, { recursive: true, force: true });
      const rollback = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --publish-only --source-run-id ${firstSummary.deployRunId} --rollback --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(rollback.stdout));
      assert.equal(summary.operationKind, "rollback");
      assert.equal(summary.runClassification, "rollback");
      assert.equal(summary.parentRunId, firstSummary.deployRunId);
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
      assert.equal(record.parentRunId, firstSummary.deployRunId);
      assert.equal(record.artifact.identity, firstSummary.artifactIdentity);
      assert.equal(record.artifactLineageId, firstSummary.artifactIdentity);
      assert.match(await fsp.readFile(liveIndexPath(hostRoot, "demoapp"), "utf8"), /v1/);
    } finally {
      await harness.close();
      await server.close();
    }
  });
});
