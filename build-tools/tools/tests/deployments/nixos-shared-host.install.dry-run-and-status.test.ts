#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";

test("nixos-shared-host host install dry-run is deterministic and non-mutating", async () => {
  await runInTemp("nixos-shared-host-host-install-dry-run", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({ root: tmp, topology: "plain" });
    const first = JSON.parse(
      String(
        (
          await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin --dry-run`
        ).stdout,
      ),
    );
    const second = JSON.parse(
      String(
        (
          await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin --dry-run`
        ).stdout,
      ),
    );
    assert.deepEqual(first.manifest, second.manifest);
    await assert.rejects(
      fsp.access(
        path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
      ),
    );
  });
});

test("nixos-shared-host host status reports partially drifted installs", async () => {
  await runInTemp("nixos-shared-host-host-status", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({ root: tmp, topology: "plain" });
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    await fsp.writeFile(
      path.join(fixture.hostRoot, "etc/nixos/configuration.nix"),
      "{ ... }:\n{\n  imports = [\n    ./hardware-configuration.nix\n  ];\n}\n",
      "utf8",
    );
    const result =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host status --host-root ${fixture.hostRoot} --config-root /etc/nixos`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.managed, true);
    assert.equal(summary.wiringState, "missing");
    assert.ok(
      summary.existingManagedPaths.includes("/etc/nixos/bucknix/nixos-shared-host/default.nix"),
    );
  });
});

test("nixos-shared-host host status reports uninstalled hosts and uninstall dry-run is non-destructive", async () => {
  await runInTemp("nixos-shared-host-host-uninstalled", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({ root: tmp, topology: "plain" });
    const status =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host status --host-root ${fixture.hostRoot} --config-root /etc/nixos`;
    assert.equal(JSON.parse(String(status.stdout)).managed, false);
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host uninstall --host-root ${fixture.hostRoot} --config-root /etc/nixos --dry-run`;
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
    );
  });
});
