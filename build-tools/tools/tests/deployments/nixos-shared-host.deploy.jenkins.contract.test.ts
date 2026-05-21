#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  writeArtifact,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture";

test("jenkins wrapper contract", async (t) => {
  await runInTemp("nixos-shared-host-jenkins-contract", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>plan</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/viberoots",
      "/etc/nixos/deployment-host/platform-state.json",
      "/var/lib/deployment-host/runtime",
      "/var/lib/deployment-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);

    await t.test("emits a stable machine-readable preflight plan", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --plan`;
      const summary = JSON.parse(String(result.stdout));
      assert.equal(summary.ok, true);
      assert.equal(summary.planOnly, true);
      assert.equal(summary.remotePlan.profileName, "mini");
      assert.equal(summary.remotePlan.destination, "mini");
      assert.equal(summary.remotePlan.remoteRepoPath, "/srv/viberoots");
      assert.equal(summary.jenkinsContract.transport.nonInteractive, true);
      assert.equal(summary.jenkinsContract.transport.identityFile, auth.identityFile);
      assert.equal(summary.jenkinsContract.transport.knownHostsFile, auth.knownHostsFile);
      assert.equal(summary.jenkinsContract.serviceSubmission.mode, "control-plane-service");
      assert.match(summary.jenkinsContract.commands.deploy, /--idempotency-key <stable-ci-key>/);
      assert.match(summary.jenkinsContract.commands.deploy, /--admission-evidence-json/);
    });

    await t.test("fails closed on missing artifact input and still emits JSON", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${path.join(tmp, "missing-artifact")} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile}`.nothrow();
      assert.notEqual(result.exitCode, 0);
      const failure = JSON.parse(String(result.stdout));
      assert.equal(failure.ok, false);
      assert.equal(failure.error.code, "missing_artifact_dir");
    });

    await t.test("fails closed on missing reviewed SSH host metadata", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${path.join(tmp, "missing-known-hosts")}`.nothrow();
      assert.notEqual(result.exitCode, 0);
      const failure = JSON.parse(String(result.stdout));
      assert.equal(failure.ok, false);
      assert.equal(failure.error.code, "missing_ssh_known_hosts");
    });

    await t.test("rejects incompatible host-apply flags", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --apply-host --apply-host-dry-run`.nothrow();
      assert.notEqual(result.exitCode, 0);
      const failure = JSON.parse(String(result.stdout));
      assert.equal(failure.ok, false);
      assert.equal(failure.error.code, "incompatible_flags");
    });

    await t.test("rejects unsupported local control-plane flags", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --control-plane-url http://127.0.0.1:7780`.nothrow();
      assert.notEqual(result.exitCode, 0);
      const failure = JSON.parse(String(result.stdout));
      assert.equal(failure.ok, false);
      assert.equal(failure.error.code, "unsupported_flag");
      assert.match(failure.error.message, /--control-plane-url/);
    });

    await t.test("rejects legacy host apply flags in service-only mode", async () => {
      const result = await $({
        cwd: tmp,
        env: { ...process.env, IN_NIX_SHELL: "1" },
      })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino/dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --apply-host`.nothrow();
      assert.notEqual(result.exitCode, 0);
      const failure = JSON.parse(String(result.stdout));
      assert.equal(failure.ok, false);
      assert.equal(failure.error.code, "unsupported_flag");
      assert.match(failure.error.message, /service-only Jenkins wrapper/);
    });
  });
});
