#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  installClientProfile,
  installReviewedPleominoTargets,
  writeArtifact,
  writeJenkinsAuthFiles,
} from "./nixos-shared-host.jenkins.fixture.ts";

test("jenkins wrapper emits a stable machine-readable preflight plan", async () => {
  await runInTemp("nixos-shared-host-jenkins-plan", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>plan</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --plan`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.ok, true);
    assert.equal(summary.planOnly, true);
    assert.equal(summary.remotePlan.profileName, "mini");
    assert.equal(summary.remotePlan.destination, "mini");
    assert.equal(summary.remotePlan.remoteRepoPath, "/srv/common");
    assert.equal(summary.jenkinsContract.transport.nonInteractive, true);
    assert.equal(summary.jenkinsContract.transport.identityFile, auth.identityFile);
    assert.equal(summary.jenkinsContract.transport.knownHostsFile, auth.knownHostsFile);
    assert.equal(summary.jenkinsContract.serviceSubmission.mode, "control-plane-service");
  });
});

test("jenkins wrapper fails closed on missing artifact input and still emits JSON", async () => {
  await runInTemp("nixos-shared-host-jenkins-missing-artifact", async (tmp, $) => {
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${path.join(tmp, "missing-artifact")} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const failure = JSON.parse(String(result.stdout));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "missing_artifact_dir");
  });
});

test("jenkins wrapper fails closed on missing reviewed SSH host metadata", async () => {
  await runInTemp("nixos-shared-host-jenkins-missing-known-hosts", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>known-hosts</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${path.join(tmp, "missing-known-hosts")}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const failure = JSON.parse(String(result.stdout));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "missing_ssh_known_hosts");
  });
});

test("jenkins wrapper rejects incompatible host-apply flags", async () => {
  await runInTemp("nixos-shared-host-jenkins-incompatible-flags", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>flags</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --apply-host --apply-host-dry-run`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const failure = JSON.parse(String(result.stdout));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "incompatible_flags");
  });
});

test("jenkins wrapper rejects unsupported local control-plane flags", async () => {
  await runInTemp("nixos-shared-host-jenkins-control-plane-flags", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>control-plane</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --control-plane-url http://127.0.0.1:7780`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const failure = JSON.parse(String(result.stdout));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "unsupported_flag");
    assert.match(failure.error.message, /--control-plane-url/);
  });
});

test("jenkins wrapper rejects legacy host apply flags in service-only mode", async () => {
  await runInTemp("nixos-shared-host-jenkins-host-apply", async (tmp, $) => {
    const artifactDir = path.join(tmp, "artifact");
    const profileRoot = path.join(tmp, "profiles");
    await installReviewedPleominoTargets(tmp);
    await writeArtifact(artifactDir, { "index.html": "<html>host-apply</html>\n" });
    await installClientProfile(
      $,
      profileRoot,
      "/srv/common",
      "/var/lib/nixos-shared-host/platform-state.json",
      "/var/lib/nixos-shared-host/runtime",
      "/var/lib/nixos-shared-host/records",
      "http://127.0.0.1:7780",
    );
    const auth = await writeJenkinsAuthFiles(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, IN_NIX_SHELL: "1" },
    })`build-tools/tools/bin/nixos-shared-host-jenkins-deploy --deployment //projects/deployments/pleomino-dev:deploy --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --ssh-identity-file ${auth.identityFile} --ssh-known-hosts ${auth.knownHostsFile} --apply-host`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const failure = JSON.parse(String(result.stdout));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "unsupported_flag");
    assert.match(failure.error.message, /service-only Jenkins wrapper/);
  });
});
