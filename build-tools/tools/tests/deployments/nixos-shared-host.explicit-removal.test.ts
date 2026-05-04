#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import {
  readBackendSnapshot,
  readRecord,
  startControlPlaneHarness,
} from "./nixos-shared-host.control-plane.helpers";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
}

test("nixos-shared-host deploy CLI records explicit removal and cleans up the realized target", async () => {
  await runInTemp("nixos-shared-host-explicit-removal", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture();
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    const statePath = path.join(tmp, "platform-state.json");
    const recordsRoot = path.join(tmp, "records");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
      tmp,
      $,
      deploymentLabel: deployment.label,
      deployment,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot,
      statePath,
      recordsRoot,
    });
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --artifact-dir ${artifactDir} --control-plane-url ${harness.controlPlane.url} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const removal = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy-internal.ts --deployment ${deployment.label} --admission-evidence-json ${admissionEvidenceJson} --control-plane-url ${harness.controlPlane.url} --remove`;
      const summary = JSON.parse(String(removal.stdout));
      assert.equal(summary.runClassification, "explicit_removal");
      assert.equal(summary.finalOutcome, "succeeded");
      const record = await readRecord(harness.controlPlane.url, summary.deployRunId);
      assert.equal(record.operationKind, "deploy");
      assert.equal(record.runClassification, "explicit_removal");
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(record.controlPlane.submissionId, summary.controlPlane.submissionId);
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      const snapshot = await readBackendSnapshot(
        recordsRoot,
        String(record.controlPlane.submissionId),
      );
      assert.equal(snapshot.action.kind, "explicit_removal");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      await assert.rejects(fsp.access(path.join(hostRoot, "containers", "demoapp")));
      const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
      assert.deepEqual(state.deployments, []);
    } finally {
      await server.close();
      await harness.close();
    }
  });
});
