#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake.ts";
import {
  installClientProfile,
  installManagedRemoteHost,
  installReviewedPleominoTargets,
  pleominoDeploymentFixture,
  prepareReviewedRemoteHostPaths,
  writeArtifact,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture.ts";

test("jenkins wrapper stages the Pleomino artifact, runs remote deploy, optionally applies the host, and emits stable JSON", async () => {
  await runInTemp("nixos-shared-host-jenkins-exec", async (tmp, $) => {
    const deployment = pleominoDeploymentFixture();
    const { env } = await installFakeRemoteTransport(tmp);
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    const remoteRuntimeRoot = path.join(tmp, "remote-runtime");
    const remoteRecordsRoot = path.join(tmp, "remote-records");
    const remoteStatePath = path.join(tmp, "remote-state", "platform-state.json");
    const rebuildLog = path.join(tmp, "nixos-rebuild.log");
    await installReviewedPleominoTargets(tmp);
    await prepareReviewedRemoteHostPaths({
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    });
    await writeArtifact(artifactDir, { "index.html": "<html>jenkins</html>\n", healthz: "ok\n" });
    await installClientProfile(
      $,
      profileRoot,
      tmp,
      remoteStatePath,
      remoteRuntimeRoot,
      remoteRecordsRoot,
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const fixture = await installManagedRemoteHost($, tmp);
    const server = await startNixosSharedHostPublicServer({
      deployment,
      hostRoot: remoteRuntimeRoot,
    });
    try {
      const result = await $({
        cwd: tmp,
        env: {
          ...env,
          FAKE_NIXOS_REBUILD_LOG: rebuildLog,
          IN_NIX_SHELL: "1",
          NIXOS_SHARED_HOST_SERVER_ROOT: fixture.hostRoot,
        },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --apply-host --smoke-connect-host 127.0.0.1 --smoke-connect-port ${String(server.port)} --smoke-connect-protocol https:`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.ok, true);
      assert.equal(summary.schemaVersion, "nixos-shared-host-jenkins-deploy@1");
      assert.equal(summary.remotePlan.destination, "mini");
      assert.equal(summary.jenkinsContract.transport.identityFile, auth.identityFile);
      assert.equal(summary.jenkinsContract.transport.knownHostsFile, auth.knownHostsFile);
      assert.equal(summary.remoteExecution.remoteDeployResult.finalOutcome, "succeeded");
      assert.equal(summary.remoteExecution.hostApply.selectedMode, "switch");
      assert.equal(summary.remoteExecution.hostApply.result.applied, true);
      const liveIndex = path.join(
        nixosSharedHostContainerRoot(remoteRuntimeRoot, deployment.providerTarget.containerName),
        "srv/static-app/live/index.html",
      );
      assert.equal(await fsp.readFile(liveIndex, "utf8"), "<html>jenkins</html>\n");
      assert.match(await fsp.readFile(rebuildLog, "utf8"), /switch/);
    } finally {
      await server.close();
    }
  });
});
