#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>demoapp</html>\n", "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

test("nixos-shared-host deploy CLI completes the shared-dev static-webapp flow end to end", async () => {
  await runInTemp("nixos-shared-host-e2e", async (tmp, $) => {
    const deployment = nixosSharedHostDeploymentFixture({
      runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
    });
    const deploymentJson = path.join(tmp, "deployment.json");
    const artifactDir = path.join(tmp, "artifact");
    const hostRoot = path.join(tmp, "host");
    await writeArtifact(artifactDir);
    await fsp.writeFile(deploymentJson, JSON.stringify(deployment, null, 2) + "\n", "utf8");
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot });
    try {
      const result = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment-json ${deploymentJson} --artifact-dir ${artifactDir} --host-root ${hostRoot} --state ${path.join(tmp, "platform-state.json")} --records-root ${path.join(tmp, "records")} --host-config-out ${path.join(tmp, "rendered-host.json")} --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.operationKind, "deploy");
      assert.equal(summary.runClassification, "deploy");
      assert.equal(summary.finalOutcome, "succeeded");
      assert.equal(summary.publicUrl, "https://demoapp.apps.kilty.io/");
      assert.equal(summary.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      const record = JSON.parse(await fsp.readFile(summary.recordPath, "utf8"));
      assert.equal(record.schemaVersion, "deploy-record@2026-04-04");
      assert.equal(record.deployRunId, summary.deployRunId);
      assert.equal(record.runClassification, "deploy");
      assert.equal(record.lifecycleState, "finished");
      assert.equal(record.provider, "nixos-shared-host");
      assert.equal(record.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(record.controlPlane.submissionId, summary.controlPlane.submissionId);
      assert.equal(record.controlPlane.lockScope, "nixos-shared-host:default:demoapp");
      assert.equal(
        record.controlPlane.executionSnapshotPath,
        summary.controlPlane.executionSnapshotPath,
      );
      assert.equal(record.artifact.identity, summary.artifactIdentity);
      assert.match(record.artifact.storedArtifactPath, /records\/artifacts\/blobs\//);
      assert.match(record.artifact.provenancePath, /records\/artifacts\/provenance\//);
      assert.match(record.deploymentMetadataFingerprint, /^sha256:/);
      assert.match(record.replaySnapshotPath, /records\/replay\//);
      assert.equal(record.finalOutcome, "succeeded");
      const snapshot = JSON.parse(
        await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8"),
      );
      assert.equal(snapshot.operationKind, "deploy");
      assert.equal(snapshot.deploymentLabel, "//projects/deployments/demoapp-dev:deploy");
      assert.equal(snapshot.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(snapshot.action.publishBehavior, "deploy");
      await fsp.rm(artifactDir, { recursive: true, force: true });
      const replayInspect = await $({
        cwd: tmp,
      })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-replay-inspect.ts --record-path ${summary.recordPath}`;
      const replay = JSON.parse(String(replayInspect.stdout));
      assert.equal(replay.deployRunId, summary.deployRunId);
      assert.equal(replay.providerTargetIdentity, "nixos-shared-host:default:demoapp");
      assert.equal(replay.artifact.identity, summary.artifactIdentity);
      assert.equal(replay.replaySnapshotPath, record.replaySnapshotPath);
      assert.equal(replay.deploymentMetadataFingerprint, record.deploymentMetadataFingerprint);
      const rendered = JSON.parse(await fsp.readFile(path.join(tmp, "rendered-host.json"), "utf8"));
      assert.ok(rendered.containers.demoapp);
    } finally {
      await server.close();
    }
  });
});
