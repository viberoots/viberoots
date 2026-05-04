#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { createNixosSharedHostPlatformState } from "../../deployments/nixos-shared-host-platform";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

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
        route = {
          onlySSL = system.config.services.nginx.virtualHosts."demoapp.apps.kilty.io".onlySSL;
          useACMEHost = system.config.services.nginx.virtualHosts."demoapp.apps.kilty.io".useACMEHost;
          proxyPass = system.config.services.nginx.virtualHosts."demoapp.apps.kilty.io".locations."/".proxyPass;
        };
        bindMount = system.config.containers.demoapp.bindMounts."/srv/static-app";
        allowedTCPPorts = system.config.containers.demoapp.config.networking.firewall.allowedTCPPorts;
        containerPostStart = system.config.systemd.services."container@demoapp".postStart;
        rendered = system.config.nixosSharedHost.rendered.demoapp;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      containers: string[];
      routes: string[];
      route: {
        onlySSL: boolean;
        useACMEHost: string;
        proxyPass: string;
      };
      bindMount: {
        hostPath: string;
        isReadOnly: boolean;
      };
      allowedTCPPorts: number[];
      containerPostStart: string;
      rendered: Record<string, unknown>;
    };
    assert.deepEqual(out.containers, ["demoapp"]);
    assert.deepEqual(out.routes, ["demoapp.apps.kilty.io"]);
    assert.equal(out.route.onlySSL, true);
    assert.equal(out.route.useACMEHost, "apps.kilty.io");
    assert.match(out.route.proxyPass, /^http:\/\/10\.234\.\d+\.\d+:3000$/);
    assert.equal(
      out.bindMount.hostPath,
      "/var/lib/deployment-host/runtime/containers/demoapp/srv/static-app",
    );
    assert.equal(out.bindMount.isReadOnly, false);
    assert.deepEqual(out.allowedTCPPorts, [3000]);
    assert.match(out.containerPostStart, /chown -R deployment-host:deployment-host/);
    assert.match(
      out.containerPostStart,
      /\/var\/lib\/deployment-host\/runtime\/containers\/demoapp\/srv\/static-app/,
    );
    assert.equal(out.rendered.hostname, "demoapp.apps.kilty.io");
    assert.equal(out.rendered.backendIdentity, "demoapp:3000");
    assert.equal(out.rendered.runtime, "static-app-host");
  });
});

test("nixos-shared-host Nix module renders the reviewed SSR host runtime contract", async () => {
  await runInTemp("nixos-shared-host-module-ssr-eval", async (tmp, $) => {
    const statePath = path.join(tmp, "nixos-shared-host-platform-state.json");
    await fsp.writeFile(
      statePath,
      JSON.stringify(
        createNixosSharedHostPlatformState([
          nixosSharedHostDeploymentFixture({
            component: { kind: "ssr-webapp", target: "//projects/apps/demoapp:app" },
            publisher: { type: "nixos-shared-host-ssr-webapp" },
            runtime: {
              appName: "demoapp",
              containerPort: 3000,
              healthPath: "/healthz",
              runtimeContract: {
                type: "node-dist-server-v1",
                framework: "vite",
                serverEntry: "dist/server/index.js",
                clientDir: "dist/client",
                servingTopology: "single-host-node-with-nginx",
                environmentNeutralBuild: true,
                runtimeConfigInjection: "runtime_config_requirements",
                secretInjection: "secret_requirements",
              },
            } as any,
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
        bindMount = system.config.containers.demoapp.bindMounts."/srv/ssr-app";
        allowedTCPPorts = system.config.containers.demoapp.config.networking.firewall.allowedTCPPorts;
        rendered = system.config.nixosSharedHost.rendered.demoapp;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      bindMount: {
        hostPath: string;
        isReadOnly: boolean;
      };
      allowedTCPPorts: number[];
      rendered: Record<string, unknown>;
    };
    const rendered = out.rendered;
    assert.equal(
      out.bindMount.hostPath,
      "/var/lib/deployment-host/runtime/containers/demoapp/srv/ssr-app",
    );
    assert.equal(out.bindMount.isReadOnly, false);
    assert.deepEqual(out.allowedTCPPorts, [3000]);
    assert.equal(rendered.runtime, "ssr-webapp-host");
    assert.equal(rendered.serverEntry, "/srv/ssr-app/live/dist/server/index.js");
    assert.equal(rendered.clientDir, "/srv/ssr-app/live/dist/client");
  });
});
