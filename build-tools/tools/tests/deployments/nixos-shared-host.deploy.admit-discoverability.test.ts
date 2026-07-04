#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL,
  freshRemoteExecBuckEnv,
  prepareRemoteExecFixture,
  requireSampleWebappDevCheck,
  remoteExecEnv,
} from "./nixos-shared-host.deploy.remote-exec.helpers";
import {
  installReviewedSampleWebappTargets,
  jenkinsExecEnv,
  writeArtifact,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture";
import { installFakeRemoteTransport } from "./nixos-shared-host.remote-transport.fake";
import { runInTemp } from "../lib/test-helpers";

test("remote profile deploy surface keeps missing admission guidance discoverable", async () => {
  await runInTemp("nixos-shared-host-remote-admit-discoverability", async (tmp, $) => {
    const fixture = await prepareRemoteExecFixture({
      tmp,
      $,
      artifactFiles: { "index.html": "<html>sample-webapp</html>\n", healthz: "ok\n" },
    });
    await requireSampleWebappDevCheck(tmp);
    const result = await $({
      cwd: tmp,
      env: freshRemoteExecBuckEnv(tmp, remoteExecEnv(fixture.env)),
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment ${REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL} --profile mini --profile-root ${fixture.profileRoot} --artifact-dir ${fixture.artifactDir} --admit-and-deploy`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /deploy\/sample-webapp-dev/);
    assert.match(
      String(result.stderr),
      /Run this instead: deploy --deployment \/\/projects\/deployments\/sample-webapp\/dev:deploy --profile mini .* --admit-and-deploy deploy\/sample-webapp-dev/,
    );
  });
});

test("jenkins wrapper preserves missing admission guidance from the deploy front door", async () => {
  await runInTemp("nixos-shared-host-jenkins-admit-discoverability", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const { env } = await installFakeRemoteTransport(tmp);
    await installReviewedSampleWebappTargets(tmp);
    await requireSampleWebappDevCheck(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>bootstrap</html>\n" });
    const auth = await writeJenkinsAuthFiles(tmp);
    const jenkinsDeploy = viberootsToolScript(
      "viberoots/build-tools/tools/bin/nixos-shared-host-jenkins-deploy",
    );
    const result = await $({
      cwd: tmp,
      env: jenkinsExecEnv(env),
      stdio: "pipe",
    })`${jenkinsDeploy} --deployment ${REVIEWED_SAMPLE_WEBAPP_DEPLOYMENT_LABEL} --profile mini --artifact-dir ${artifactDir} --admit-and-deploy --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.ok, false);
    assert.match(String(summary.error.message), /deploy\/sample-webapp-dev/);
    assert.match(
      String(summary.error.message),
      /Run this instead: deploy --deployment \/\/projects\/deployments\/sample-webapp\/dev:deploy --profile mini .* --admit-and-deploy deploy\/sample-webapp-dev/,
    );
  });
});
