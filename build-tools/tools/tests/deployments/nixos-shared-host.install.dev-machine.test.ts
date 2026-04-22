#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nixos-shared-host client install accepts required parameters by flags", async () => {
  await runInTemp("nixos-shared-host-client-flags", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.profileName, "mini");
    assert.equal(summary.manifest.destination, "mini");
    assert.equal(summary.manifest.remoteRepoPath, "/srv/common");
    assert.equal(
      summary.manifest.remoteStatePath,
      "/etc/nixos/deployment-host/platform-state.json",
    );
    assert.equal(summary.manifest.remoteRuntimeRoot, "/var/lib/deployment-host/runtime");
    assert.equal(summary.manifest.remoteRecordsRoot, "/var/lib/deployment-host/records");
    assert.equal(summary.manifest.sshMode, "ssh");
    assert.equal(
      summary.manifest.serviceClient.controlPlaneTokenEnv,
      "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
    );
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client install accepts required parameters by stdin and applies declarative defaults when stdin is partial", async () => {
  await runInTemp("nixos-shared-host-client-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const payload = JSON.stringify({
      profileName: "mini",
      destination: "mini",
      remoteRepoPath: "/srv/common",
      remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
      remoteRecordsRoot: "/var/lib/deployment-host/records",
      sshMode: "ssh",
      controlPlaneUrl: "http://127.0.0.1:7780",
    });
    const ok = await $({
      input: payload,
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot}`;
    assert.equal(JSON.parse(String(ok.stdout)).manifest.destination, "mini");
    const partial = await $({
      input: '{"profileName":"mini"}',
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot}`.nothrow();
    assert.equal(partial.exitCode, 0);
    const partialSummary = JSON.parse(String(partial.stdout));
    assert.equal(partialSummary.manifest.profileName, "mini");
    assert.equal(partialSummary.manifest.destination, "mini");
    assert.equal(partialSummary.manifest.remoteRepoPath, "/srv/common");
    assert.equal(
      partialSummary.manifest.remoteStatePath,
      "/etc/nixos/deployment-host/platform-state.json",
    );
    assert.equal(partialSummary.manifest.remoteRuntimeRoot, "/var/lib/deployment-host/runtime");
    assert.equal(partialSummary.manifest.remoteRecordsRoot, "/var/lib/deployment-host/records");
    assert.equal(partialSummary.manifest.sshMode, "ssh");
    assert.equal(partialSummary.manifest.serviceClient.controlPlaneUrl, "http://127.0.0.1:7780");
    assert.equal(
      partialSummary.manifest.serviceClient.controlPlaneTokenEnv,
      "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
    );
  });
});

test("nixos-shared-host client install ignores empty stdin", async () => {
  await runInTemp("nixos-shared-host-client-empty-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result = await $({
      input: "",
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.profileName, "mini");
    assert.equal(summary.manifest.destination, "mini");
    assert.equal(summary.manifest.remoteRepoPath, "/srv/common");
    assert.equal(
      summary.manifest.remoteStatePath,
      "/etc/nixos/deployment-host/platform-state.json",
    );
    assert.equal(summary.manifest.remoteRuntimeRoot, "/var/lib/deployment-host/runtime");
    assert.equal(summary.manifest.remoteRecordsRoot, "/var/lib/deployment-host/records");
    assert.equal(summary.manifest.sshMode, "ssh");
    assert.equal(
      summary.manifest.serviceClient.controlPlaneTokenEnv,
      "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
    );
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client list reports installed profiles", async () => {
  await runInTemp("nixos-shared-host-client-list", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client list --output-root ${outputRoot}`;
    const summary = JSON.parse(String(result.stdout));
    assert.deepEqual(
      summary.profiles.map(
        (entry: { manifest: { profileName: string } }) => entry.manifest.profileName,
      ),
      ["mini", "staging"],
    );
  });
});

test("nixos-shared-host client list reports malformed profiles without blocking valid ones", async () => {
  await runInTemp("nixos-shared-host-client-list-invalid", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(
      path.join(outputRoot, "default.json"),
      JSON.stringify(
        {
          schemaVersion: "nixos-shared-host-client@1",
          tool: "nixos-shared-host-install",
          toolFingerprint: "old",
          profileName: "default",
          destination: "default",
          remoteRepoPath: "/srv/common",
          remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
          remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
          remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
          sshMode: "ssh",
          localManagedPaths: [path.join(outputRoot, "default.json")],
        },
        null,
        2,
      ),
    );
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --control-plane-url http://127.0.0.1:7780`;
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client list --output-root ${outputRoot}`;
    const summary = JSON.parse(String(result.stdout));
    assert.deepEqual(
      summary.profiles.map(
        (entry: { manifest: { profileName: string } }) => entry.manifest.profileName,
      ),
      ["mini"],
    );
    assert.deepEqual(
      summary.invalidProfiles.map((entry: { profileName: string }) => entry.profileName),
      ["default"],
    );
  });
});

test("nixos-shared-host client uninstall removes exactly one profile when --profile is provided", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-profile", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const uninstall =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --profile mini`;
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["mini"]);
    await assert.rejects(() => fsp.access(path.join(outputRoot, "mini.json")));
    await fsp.access(path.join(outputRoot, "staging.json"));
  });
});

test("nixos-shared-host client uninstall removes malformed profiles by name", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-invalid", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await fsp.mkdir(outputRoot, { recursive: true });
    const staleProfile = path.join(outputRoot, "default.json");
    await fsp.writeFile(staleProfile, '{"profileName":"default"}');
    const uninstall =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --profile default`;
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["default"]);
    assert.deepEqual(summary.removedPaths, [staleProfile]);
    assert.deepEqual(
      summary.invalidProfiles.map((entry: { profileName: string }) => entry.profileName),
      ["default"],
    );
    await assert.rejects(() => fsp.access(staleProfile));
  });
});

test("nixos-shared-host client uninstall fails for a missing profile", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-missing-profile", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --profile missing`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /ENOENT|no such file/i);
  });
});

test("nixos-shared-host client uninstall removes all profiles when --all is provided", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-all", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/common --remote-state-path /etc/nixos/deployment-host/platform-state.json --remote-runtime-root /var/lib/deployment-host/runtime --remote-records-root /var/lib/deployment-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const uninstall =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --all`;
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["mini", "staging"]);
    const list =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client list --output-root ${outputRoot}`;
    assert.deepEqual(JSON.parse(String(list.stdout)).profiles, []);
  });
});

test("nixos-shared-host client uninstall fails closed without --profile or --all", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-missing-selector", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot}`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /requires --profile <name> or --all/);
  });
});

test("nixos-shared-host client uninstall fails closed when --profile and --all are combined", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-conflicting-selectors", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --profile mini --all`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /either --profile or --all, not both/);
  });
});
