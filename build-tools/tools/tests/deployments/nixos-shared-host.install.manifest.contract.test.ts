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
    installMode: "managed-dropin",
    configTopology: "plain",
    configRoot: "/etc/nixos",
    managedRoot: "/etc/nixos/bucknix/nixos-shared-host",
    statePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
    runtimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
    recordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
  });
  assert.equal(parseInstallManifest(manifest).schemaVersion, "nixos-shared-host-install@1");
});

test("nixos-shared-host install manifest migrates reviewed legacy v0 schema", () => {
  const manifest = parseInstallManifest({
    schemaVersion: "nixos-shared-host-install@0",
    installMode: "emit-only",
    configRoot: "/etc/nixos",
    managedRoot: "/etc/nixos/bucknix/nixos-shared-host",
    statePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
    runtimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
    recordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
    dropInPath: "/etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix",
    anchorPath: "/etc/nixos/bucknix/nixos-shared-host/default.nix",
  });
  assert.equal(manifest.schemaVersion, "nixos-shared-host-install@1");
  assert.equal(manifest.installMode, "emit-only");
  assert.equal(
    manifest.managedEntryPoints.anchorPath,
    "/etc/nixos/bucknix/nixos-shared-host/default.nix",
  );
});
