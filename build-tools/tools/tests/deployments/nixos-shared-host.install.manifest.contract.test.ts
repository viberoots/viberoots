#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createInstallManifestV1,
  parseInstallManifest,
} from "../../deployments/nixos-shared-host-install-contract.ts";

test("nixos-shared-host install manifest parses current schema", () => {
  const manifest = createInstallManifestV1({
    toolFingerprint: "abc123",
    installMode: "managed-manual-wire",
    configTopology: "plain",
    configRoot: "/etc/nixos",
    configEntryPath: "/etc/nixos/configuration.nix",
    managedRoot: "/etc/nixos/deployment-host",
    statePath: "/etc/nixos/deployment-host/platform-state.json",
    runtimeRoot: "/var/lib/deployment-host/runtime",
    recordsRoot: "/var/lib/deployment-host/records",
  });
  const parsed = parseInstallManifest(manifest);
  assert.equal(parsed.schemaVersion, "nixos-shared-host-install@1");
  assert.equal(parsed.installMode, "managed-manual-wire");
  assert.equal(parsed.configEntryPath, "/etc/nixos/configuration.nix");
  assert.equal(parsed.configInjection, undefined);
  assert.deepEqual(parsed.managedPaths, [
    "/etc/nixos/deployment-host/default.nix",
    "/etc/nixos/deployment-host/deployment-host-managed.nix",
    "/etc/nixos/deployment-host/install-manifest.json",
  ]);
  assert.deepEqual(parsed.managedDirectories, ["/etc/nixos/deployment-host"]);
  assert.equal(parsed.statePath, "/etc/nixos/deployment-host/platform-state.json");
  assert.equal(parsed.runtimeRoot, "/var/lib/deployment-host/runtime");
  assert.equal(parsed.recordsRoot, "/var/lib/deployment-host/records");
});
