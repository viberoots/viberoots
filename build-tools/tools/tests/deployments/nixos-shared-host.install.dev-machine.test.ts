#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nixos-shared-host dev-machine install accepts required parameters by flags", async () => {
  await runInTemp("nixos-shared-host-dev-machine-flags", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts dev-machine install --output-root ${outputRoot} --profile mini --destination mini --remote-repo-path /srv/bucknix --remote-state-path /var/lib/bucknix/nixos-shared-host/platform-state.json --remote-runtime-root /var/lib/bucknix/nixos-shared-host/runtime --remote-records-root /var/lib/bucknix/nixos-shared-host/records --ssh-mode ssh`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.profileName, "mini");
    assert.equal(summary.manifest.destination, "mini");
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host dev-machine install accepts required parameters by stdin and fails closed when incomplete", async () => {
  await runInTemp("nixos-shared-host-dev-machine-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const payload = JSON.stringify({
      profileName: "mini",
      destination: "mini",
      remoteRepoPath: "/srv/bucknix",
      remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
      remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
      sshMode: "ssh",
    });
    const ok = await $({
      input: payload,
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts dev-machine install --output-root ${outputRoot}`;
    assert.equal(JSON.parse(String(ok.stdout)).manifest.destination, "mini");
    const bad = await $({
      input: '{"profileName":"mini"}',
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts dev-machine install --output-root ${outputRoot}`.nothrow();
    assert.notEqual(bad.exitCode, 0);
    assert.match(String(bad.stderr || ""), /missing required dev-machine parameter "destination"/);
  });
});
