#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

test("nixos-shared-host Nix module derives containers and nginx routes from authoritative platform state", async () => {
  await runInTemp("nixos-shared-host-module-eval", async (tmp, $) => {
    const statePath = path.join(tmp, "nixos-shared-host-platform-state.json");
    await fsp.writeFile(
      statePath,
      JSON.stringify(
        createNixosSharedHostPlatformState([
          nixosSharedHostDeploymentFixture({
            runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
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
      in {
        containers = builtins.attrNames system.config.containers;
        routes = builtins.attrNames system.config.services.nginx.virtualHosts;
        rendered = system.config.nixosSharedHost.rendered.demoapp;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      containers: string[];
      routes: string[];
      rendered: Record<string, unknown>;
    };
    assert.deepEqual(out.containers, ["demoapp"]);
    assert.deepEqual(out.routes, ["demoapp.apps.kilty.io"]);
    assert.equal(out.rendered.hostname, "demoapp.apps.kilty.io");
    assert.equal(out.rendered.backendIdentity, "demoapp:3000");
    assert.equal(out.rendered.runtime, "static-app-host");
  });
});
