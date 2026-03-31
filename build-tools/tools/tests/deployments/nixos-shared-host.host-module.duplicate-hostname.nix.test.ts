#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host Nix module fails closed on duplicate hostnames", async () => {
  await runInTemp("nixos-shared-host-module-dup-host", async (tmp, $) => {
    const statePath = path.join(tmp, "nixos-shared-host-platform-state.json");
    await fsp.writeFile(
      statePath,
      JSON.stringify(
        createNixosSharedHostPlatformState([
          nixosSharedHostDeploymentFixture(),
          nixosSharedHostDeploymentFixture({
            deploymentId: "other-dev",
            label: "//projects/deployments/other-dev:deploy",
            component: { kind: "static-webapp", target: "//projects/apps/other:app" },
            runtime: { appName: "other", containerPort: 4000 },
            providerTarget: {
              host: "nixos-shared-host",
              appName: "other",
              targetGroup: "default",
              hostname: "demoapp.apps.kilty.io",
              containerName: "other",
              sharedDevTargetIdentity: "nixos-shared-host:default:other",
            },
          }),
        ]),
        null,
        2,
      ),
    );
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/nixos-shared-host-module.nix ];
            nixosSharedHost.enable = true;
            nixosSharedHost.statePath = ./. + "/nixos-shared-host-platform-state.json";
            system.stateVersion = "24.11";
          };
        };
      in builtins.attrNames system.config.containers
    `;
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix eval --impure --expr ${expr} --json`.nothrow();
    assert.notEqual(result.exitCode, 0);
    const combined = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
    assert.match(combined, /duplicate hostname in nixos-shared-host module/);
  });
});
