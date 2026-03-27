#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";

test("nixos-shared-host server install supports managed-dropin on plain /etc/nixos roots", async () => {
  await runInTemp("nixos-shared-host-host-install-plain", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
      withNginxConfig: true,
    });
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
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

test("nixos-shared-host server install supports emit-only on flake roots without mutating runtime state", async () => {
  await runInTemp("nixos-shared-host-host-install-flake", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "flake",
      withExtraImports: true,
    });
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/flake.nix --install-mode emit-only`;
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

test("nixos-shared-host server install supports managed-manual-wire without editing config entry", async () => {
  await runInTemp("nixos-shared-host-host-install-manual-wire", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
    });
    const configBefore = await fsp.readFile(
      path.join(fixture.hostRoot, "etc/nixos/configuration.nix"),
      "utf8",
    );
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-manual-wire`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.installMode, "managed-manual-wire");
    assert.equal(summary.wiringState, "missing");
    assert.equal(summary.manifest.configEntryPath, "/etc/nixos/configuration.nix");
    assert.equal(summary.manifest.configInjection, undefined);
    assert.match(String(summary.configInstruction || ""), /imports = \[ .*default\.nix .*]/);
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
    );
    await fsp.access(
      path.join(fixture.hostRoot, "var/lib/bucknix/nixos-shared-host/platform-state.json"),
    );
    assert.equal(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      configBefore,
    );
  });
});

test("nixos-shared-host server install accepts stdin JSON and flags override stdin values", async () => {
  await runInTemp("nixos-shared-host-host-install-stdin", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
    });
    const payload = JSON.stringify({
      serverRoot: fixture.hostRoot,
      configRoot: "/etc/nixos",
      configEntryPath: "/etc/nixos/configuration.nix",
      installMode: "emit-only",
      statePath: "/var/lib/bucknix/custom/platform-state.json",
    });
    const result = await $({
      input: payload,
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --install-mode managed-dropin`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.installMode, "managed-dropin");
    assert.equal(summary.manifest.statePath, "/var/lib/bucknix/custom/platform-state.json");
    await fsp.access(path.join(fixture.hostRoot, "var/lib/bucknix/custom/platform-state.json"));
  });
});

test("nixos-shared-host server install ignores empty stdin", async () => {
  await runInTemp("nixos-shared-host-host-install-empty-stdin", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
    });
    const result = await $({
      input: "",
    })`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.installMode, "managed-manual-wire");
    await fsp.access(
      path.join(fixture.hostRoot, "var/lib/bucknix/nixos-shared-host/platform-state.json"),
    );
  });
});
