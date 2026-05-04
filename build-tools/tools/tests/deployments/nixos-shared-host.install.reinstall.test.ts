#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostInstallFixture } from "./nixos-shared-host.install.fixture";

test("nixos-shared-host server uninstall removes only managed assets and supports reinstall", async () => {
  await runInTemp("nixos-shared-host-host-reinstall", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
      withNginxConfig: true,
    });
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    const sibling = path.join(fixture.hostRoot, "etc/nixos/unmanaged-sibling.txt");
    await fsp.mkdir(path.dirname(sibling), { recursive: true });
    await fsp.writeFile(sibling, "keep-me\n", "utf8");
    const statePath = path.join(fixture.hostRoot, "etc/nixos/deployment-host/platform-state.json");
    const runtimeSecret = path.join(
      fixture.hostRoot,
      "var/lib/deployment-host/runtime/secrets/do-not-remove.txt",
    );
    const recordSecret = path.join(
      fixture.hostRoot,
      "var/lib/deployment-host/records/secrets/do-not-remove.txt",
    );
    await fsp.writeFile(statePath, '{"valuable":true}\n', "utf8");
    await fsp.mkdir(path.dirname(runtimeSecret), { recursive: true });
    await fsp.writeFile(runtimeSecret, "runtime-secret\n", "utf8");
    await fsp.mkdir(path.dirname(recordSecret), { recursive: true });
    await fsp.writeFile(recordSecret, "record-secret\n", "utf8");
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server uninstall --server-root ${fixture.hostRoot} --config-root /etc/nixos`;
    await fsp.access(sibling);
    assert.equal(await fsp.readFile(statePath, "utf8"), '{"valuable":true}\n');
    assert.equal(await fsp.readFile(runtimeSecret, "utf8"), "runtime-secret\n");
    assert.equal(await fsp.readFile(recordSecret, "utf8"), "record-secret\n");
    assert.doesNotMatch(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      /BEGIN deployment-host managed block/,
    );
    await assert.rejects(
      fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/install-manifest.json")),
    );
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-dropin`;
    await fsp.access(
      path.join(fixture.hostRoot, "etc/nixos/deployment-host/install-manifest.json"),
    );
    assert.equal(await fsp.readFile(sibling, "utf8"), "keep-me\n");
  });
});

test("nixos-shared-host manual-wire uninstall leaves server config entry untouched", async () => {
  await runInTemp("nixos-shared-host-host-manual-wire-uninstall", async (tmp, $) => {
    const fixture = await createNixosSharedHostInstallFixture({
      root: tmp,
      topology: "plain",
    });
    const operatorManagedConfig =
      "{ ... }:\n{\n  imports = [\n    /etc/nixos/deployment-host/default.nix\n  ];\n}\n";
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server install --server-root ${fixture.hostRoot} --config-root /etc/nixos --config-entry-path /etc/nixos/configuration.nix --install-mode managed-manual-wire`;
    await fsp.writeFile(
      path.join(fixture.hostRoot, "etc/nixos/configuration.nix"),
      operatorManagedConfig,
      "utf8",
    );
    await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server uninstall --server-root ${fixture.hostRoot} --config-root /etc/nixos`;
    assert.equal(
      await fsp.readFile(path.join(fixture.hostRoot, "etc/nixos/configuration.nix"), "utf8"),
      operatorManagedConfig,
    );
    await assert.rejects(
      fsp.access(path.join(fixture.hostRoot, "etc/nixos/deployment-host/install-manifest.json")),
    );
    await fsp.mkdir(path.join(fixture.hostRoot, "etc/nixos/deployment-host"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(fixture.hostRoot, "etc/nixos/deployment-host/install-manifest.json"),
      JSON.stringify({
        schemaVersion: "nixos-shared-host-install@1",
        tool: "nixos-shared-host-install",
        toolFingerprint: "test",
        installMode: "managed-manual-wire",
        configTopology: "plain",
        configRoot: "/etc/nixos",
        managedRoot: "/etc/nixos/deployment-host",
        statePath: "/etc/nixos/deployment-host/platform-state.json",
        runtimeRoot: "/var/lib/deployment-host/runtime",
        recordsRoot: "/var/lib/deployment-host/records",
        managedPaths: [
          "/etc/nixos/deployment-host/install-manifest.json",
          "/var/lib/deployment-host/runtime/unsafe-generated-file",
        ],
        managedDirectories: ["/etc/nixos/deployment-host"],
        managedUsers: [],
        managedEntryPoints: {
          modulePath: "/etc/nixos/deployment-host/deployment-host-managed.nix",
          anchorPath: "/etc/nixos/deployment-host/default.nix",
        },
      }) + "\n",
      "utf8",
    );
    const unsafeUninstall =
      await $`zx-wrapper build-tools/tools/deployments/nixos-shared-host-install.ts server uninstall --server-root ${fixture.hostRoot} --config-root /etc/nixos`.nothrow();
    assert.notEqual(unsafeUninstall.exitCode, 0);
    assert.match(
      String(unsafeUninstall.stderr),
      /refusing to uninstall path outside managed config root/,
    );
  });
});
