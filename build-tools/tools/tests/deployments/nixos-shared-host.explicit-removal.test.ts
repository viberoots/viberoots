#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

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
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const removal = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --host-root ${hostRoot} --state ${statePath} --records-root ${recordsRoot} --remove`;
      const summary = JSON.parse(String(removal.stdout));
      assert.equal(summary.runClassification, "explicit_removal");
      assert.equal(summary.finalOutcome, "succeeded");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.operationKind, "deploy");
      assert.equal(record.runClassification, "explicit_removal");
      assert.equal(record.finalOutcome, "succeeded");
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(record.controlPlane.submissionId, summary.controlPlane.submissionId);
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.action.kind, "explicit_removal");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      await assert.rejects(fsp.access(path.join(hostRoot, "containers", "demoapp")));
      const state = JSON.parse(await fsp.readFile(statePath, "utf8"));
      assert.deepEqual(state.deployments, []);
    } finally {
      await server.close();
    }
  });
});
