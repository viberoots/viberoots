#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture.ts";

test("nixos-shared-host host uninstall removes only managed assets and supports reinstall", async () => {
  await runInTemp("nixos-shared-host-host-reinstall", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withNginxConfig: true,
    });
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    const sibling = path.join(fixture.hostRoot, "etc/nixos/bucknix/unmanaged.txt");
    await fsp.mkdir(path.dirname(sibling), { recursive: true });
    await fsp.writeFile(sibling, "keep-me\n", "utf8");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host uninstall --host-root ${fixture.hostRoot} --config-root /etc/nixos`;
    await fsp.access(sibling);
    assert.doesNotMatch(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      /BEGIN bucknix nixos-shared-host/,
    );
    await assert.rejects(
      fsp.access(
        path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
      ),
    );
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host install --host-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
    );
    assert.equal(await fsp.readFile(sibling, "utf8"), "keep-me\n");
  });
});

test("nixos-shared-host host uninstall accepts reviewed legacy manifest versions", async () => {
  await runInTemp("nixos-shared-host-host-uninstall-v0", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({ root: tmp, topology: "plain" });
    const managedRoot = path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host");
    await fsp.mkdir(managedRoot, { recursive: true });
    await fsp.writeFile(
      path.join(managedRoot, "install-manifest.json"),
      JSON.stringify(
        {
          schemaVersion: "nixos-shared-host-install@0",
          installMode: "managed-dropin",
          configRoot: "/etc/nixos",
          managedRoot: "/etc/nixos/bucknix/nixos-shared-host",
          statePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
          runtimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
          recordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
          dropInPath: "/etc/nixos/bucknix/nixos-shared-host/nixos-shared-host-managed.nix",
          anchorPath: "/etc/nixos/bucknix/nixos-shared-host/default.nix",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(path.join(managedRoot, "default.nix"), "{ ... }: { }\n", "utf8");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts host uninstall --host-root ${fixture.hostRoot} --config-root /etc/nixos`;
    await assert.rejects(
      fsp.access(
        path.join(fixture.hostRoot, "etc/nixos/bucknix/nixos-shared-host/install-manifest.json"),
      ),
    );
  });
});
