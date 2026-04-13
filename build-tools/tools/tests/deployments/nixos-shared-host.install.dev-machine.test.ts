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
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.profileName, "mini");
    assert.equal(summary.manifest.destination, "mini");
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client install accepts required parameters by stdin and applies declarative defaults when stdin is partial", async () => {
  await runInTemp("nixos-shared-host-client-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const payload = JSON.stringify({
      profileName: "mini",
      destination: "mini",
      remoteRepoPath: "/srv/bucknix",
      remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
      remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
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
    assert.equal(partialSummary.manifest.sshMode, "ssh");
    assert.equal(partialSummary.manifest.serviceClient.controlPlaneUrl, "http://127.0.0.1:7780");
  });
});

test("nixos-shared-host client install ignores empty stdin", async () => {
  await runInTemp("nixos-shared-host-client-empty-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result = await $({
      input: "",
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.profileName, "mini");
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client list reports installed profiles", async () => {
  await runInTemp("nixos-shared-host-client-list", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
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

test("nixos-shared-host client uninstall removes exactly one profile when --profile is provided", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-profile", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    const uninstall =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client uninstall --output-root ${outputRoot} --profile mini`;
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["mini"]);
    await assert.rejects(() => fsp.access(path.join(outputRoot, "mini.json")));
    await fsp.access(path.join(outputRoot, "staging.json"));
  });
});

test("nixos-shared-host client uninstall removes all profiles when --all is provided", async () => {
  await runInTemp("nixos-shared-host-client-uninstall-all", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts client install --output-root ${outputRoot} --profile staging --destination staging --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh --control-plane-url http://127.0.0.1:7780`;
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
