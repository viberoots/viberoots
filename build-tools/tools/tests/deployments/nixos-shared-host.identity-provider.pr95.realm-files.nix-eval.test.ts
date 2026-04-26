#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("shared-host identity provider module forwards reviewed realm files to Keycloak", async () => {
  await runInTemp("shared-host-identity-provider-realm-files-eval", async (tmp, $) => {
    const realmFile = path.join(tmp, "reviewed-realm.json");
    await fsp.writeFile(realmFile, JSON.stringify({ realm: "deployments", enabled: true }));
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-identity-provider-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.identityProvider = {
              enable = true;
              hostname = "identity.example.test";
              keycloakHttpPort = 8091;
              realmFiles = [ ./reviewed-realm.json ];
            };
          };
        };
      in {
        realmFiles = system.config.services.keycloak.realmFiles;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as { realmFiles: string[] };
    assert.equal(out.realmFiles.length, 1);
    assert.match(out.realmFiles[0] || "", /reviewed-realm\.json$/);
  });
});
