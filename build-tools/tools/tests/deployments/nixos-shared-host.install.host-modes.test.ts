#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture";

test("nixos-shared-host server install supports managed-dropin on plain /etc/nixos roots", async () => {
  await runInTemp("nixos-shared-host-host-install-plain", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withExtraImports: true,
      withNginxConfig: true,
    });
    const result =
      await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.managed, true);
    assert.equal(summary.manifest.installMode, "managed-dropin");
    assert.equal(summary.wiringState, "wired");
    await fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/platform-state.json"));
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/deployment-host/deployment-host-managed.nix"),
    );
    assert.match(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      /BEGIN deployment-host managed block/,
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
      await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/flake.nix --install-mode emit-only`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.configTopology, "flake");
    assert.equal(summary.manifest.installMode, "emit-only");
    assert.match(String(summary.configInstruction || ""), /modules = \[ .*default\.nix .*]/);
    assert.equal(
      summary.emittedSnippets.managedModulePath,
      "/etc/nixos/deployment-host/deployment-host-managed.nix",
    );
    assert.match(
      String(summary.emittedSnippets.managedModuleSource || ""),
      /nixosSharedHost\.enable = true;/,
    );
    assert.match(
      String(summary.emittedSnippets.managedModuleSource || ""),
      /\{ deploymentModulesRoot, \.\.\. \}:/,
    );
    assert.match(
      String(summary.emittedSnippets.managedModuleSource || ""),
      /\$\{deploymentModulesRoot\}\/nixos-shared-host-module\.nix/,
    );
    assert.match(
      String(summary.emittedSnippets.managedModuleSource || ""),
      /nixosSharedHost\.statePath = \.\/platform-state\.json;/,
    );
    assert.doesNotMatch(String(summary.emittedSnippets.managedModuleSource || ""), /\/srv\/common/);
    assert.doesNotMatch(String(summary.emittedSnippets.managedModuleSource || ""), /\/var\/lib/);
    assert.equal(
      summary.emittedSnippets.managedAnchorPath,
      "/etc/nixos/deployment-host/default.nix",
    );
    assert.match(String(summary.emittedSnippets.managedAnchorSource || ""), /imports = \[/);
    await assert.rejects(
      fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/platform-state.json")),
    );
    await assert.rejects(
      fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/default.nix")),
    );
  });
});

test("nixos-shared-host server install defaults the config entry to flake.nix when present", async () => {
  await runInTemp("nixos-shared-host-host-install-default-flake-entry", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "flake",
      withExtraImports: true,
    });
    const result =
      await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot}`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.configRoot, "/etc/nixos");
    assert.equal(summary.manifest.installMode, "managed-manual-wire");
    assert.equal(summary.manifest.configEntryPath, "/etc/nixos/flake.nix");
    assert.equal(summary.wiringState, "missing");
    await fsp.writeFile(
      path.join(fixture.hostRoot, "etc/nixos/flake.nix"),
      "{ outputs = { nixpkgs, ... }: { nixosConfigurations.mini = nixpkgs.lib.nixosSystem { modules = [ ./deployment-host/default.nix ]; }; }; }\n",
      "utf8",
    );
    const status =
      await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server status --server-root ${fixture.hostRoot}`;
    assert.equal(JSON.parse(String(status.stdout)).wiringState, "wired");
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
      await $`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-manual-wire`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.installMode, "managed-manual-wire");
    assert.equal(summary.wiringState, "missing");
    assert.equal(summary.manifest.configEntryPath, "/etc/nixos/configuration.nix");
    assert.equal(summary.manifest.configInjection, undefined);
    assert.match(String(summary.configInstruction || ""), /imports = \[ .*default\.nix .*]/);
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/deployment-host/install-manifest.json"),
    );
    await fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/platform-state.json"));
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
      statePath: "/var/lib/deployment-host-custom/platform-state.json",
    });
    const result = await $({
      input: payload,
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --install-mode managed-dropin`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.installMode, "managed-dropin");
    assert.equal(summary.manifest.statePath, "/var/lib/deployment-host-custom/platform-state.json");
    await fsp.access(
      path.join(fixture.hostRoot, "var/lib/deployment-host-custom/platform-state.json"),
    );
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
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} server install --server-root ${fixture.hostRoot}`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.configRoot, "/etc/nixos");
    assert.equal(summary.manifest.installMode, "managed-manual-wire");
    assert.equal(summary.manifest.configEntryPath, "/etc/nixos/configuration.nix");
    await fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/platform-state.json"));
  });
});
