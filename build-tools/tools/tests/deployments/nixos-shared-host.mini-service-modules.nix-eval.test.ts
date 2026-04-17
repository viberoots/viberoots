#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("mini postgres module evaluates as an importable reviewed host module", async () => {
  await runInTemp("mini-postgres-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/mini-postgres-module.nix ];
            system.stateVersion = "24.11";
          };
        };
      in {
        enabled = system.config.services.postgresql.enable;
        package = system.config.services.postgresql.package.pname;
        listen = system.config.services.postgresql.settings.listen_addresses;
        port = system.config.services.postgresql.settings.port;
        databases = system.config.services.postgresql.ensureDatabases;
        users = map (user: {
          name = user.name;
          ensureDBOwnership = user.ensureDBOwnership;
        }) system.config.services.postgresql.ensureUsers;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      enabled: boolean;
      package: string;
      listen: string;
      port: number;
      databases: string[];
      users: Array<{ name: string; ensureDBOwnership: boolean }>;
    };
    assert.equal(out.enabled, true);
    assert.equal(out.package, "postgresql");
    assert.equal(out.listen, "127.0.0.1");
    assert.equal(out.port, 5432);
    assert.deepEqual(out.databases, ["deployctl"]);
    assert.deepEqual(out.users, [{ name: "deployctl", ensureDBOwnership: true }]);
  });
});

test("mini vault module evaluates as an importable reviewed host module", async () => {
  await runInTemp("mini-vault-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/mini-vault-module.nix ];
            system.stateVersion = "24.11";
          };
        };
      in {
        enabled = system.config.services.vault.enable;
        package = system.config.services.vault.package.pname;
        address = system.config.services.vault.address;
        storageBackend = system.config.services.vault.storageBackend;
        storagePath = system.config.services.vault.storagePath;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      enabled: boolean;
      package: string;
      address: string;
      storageBackend: string;
      storagePath: string;
    };
    assert.equal(out.enabled, true);
    assert.equal(out.package, "vault");
    assert.equal(out.address, "127.0.0.1:8200");
    assert.equal(out.storageBackend, "raft");
    assert.equal(out.storagePath, "/var/lib/vault");
  });
});
