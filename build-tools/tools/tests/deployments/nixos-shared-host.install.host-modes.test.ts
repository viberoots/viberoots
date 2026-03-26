#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";

test("nixos-shared-host host install supports managed-dropin on plain /etc/nixos roots", async () => {
  await runInTemp("nixos-shared-host-host-install-plain", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
      withNginxConfig: true,
    });
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.managed, true);
    assert.equal(summary.manifest.installMode, "managed-dropin");
    assert.equal(summary.wiringState, "wired");
    await fsp.access(
      path.join(fixture.hostRoot, "var/lib/bucknix/nixos-shared-host/platform-state.json"),
    );
    await fsp.access(
      path.join(
        fixture.hostRoot,
        "etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix",
      ),
    );
    assert.match(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      /BEGIN bucknix nixos-shared-host/,
    );
    await fsp.access(path.join(fixture.hostRoot, "etc/nixos/nginx.nix"));
  });
});

test("nixos-shared-host host install supports emit-only on flake roots without mutating runtime state", async () => {
  await runInTemp("nixos-shared-host-host-install-flake", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "flake",
      withExtraImports: true,
    });
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/flake.nix --install-mode emit-only`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.configTopology, "flake");
    assert.equal(summary.manifest.installMode, "emit-only");
    assert.match(String(summary.configInstruction || ""), /modules = \[ .*default\.nix .*]/);
    assert.equal(
      summary.emittedSnippets.managedModulePath,
      "/etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix",
    );
    assert.match(
      String(summary.emittedSnippets.managedModuleSource || ""),
      /nixosSharedHost\.enable = true;/,
    );
    assert.equal(
      summary.emittedSnippets.managedAnchorPath,
      "/etc/nixos/bucknix/nixos-shared-host/default.nix",
    );
    assert.match(String(summary.emittedSnippets.managedAnchorSource || ""), /imports = \[/);
    await assert.rejects(
      fsp.access(
        path.join(fixture.hostRoot, "var/lib/bucknix/nixos-shared-host/platform-state.json"),
      ),
    );
    await assert.rejects(
      fsp.access(path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/default.nix")),
    );
  });
});
