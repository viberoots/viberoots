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

test("mini identity provider module evaluates as reviewed Keycloak defaults", async () => {
  await runInTemp("mini-identity-provider-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/mini-identity-provider-module.nix ];
            system.stateVersion = "24.11";
          };
        };
        host = system.config.bucknix.mini.identityProvider.hostname;
        vhost = system.config.services.nginx.virtualHosts.\${host};
      in {
        enabled = system.config.services.keycloak.enable;
        package = system.config.services.keycloak.package.pname;
        hostname = system.config.services.keycloak.settings.hostname;
        httpHost = system.config.services.keycloak.settings.http-host;
        httpPort = system.config.services.keycloak.settings.http-port;
        databaseType = system.config.services.keycloak.database.type;
        passwordFile = system.config.services.keycloak.database.passwordFile;
        initialAdminPassword =
          system.config.services.keycloak.initialAdminPassword or null;
        nginxEnabled = system.config.services.nginx.enable;
        forceSSL = vhost.forceSSL;
        enableACME = vhost.enableACME;
        proxyPass = vhost.locations."/".proxyPass;
        acmeEmail = system.config.security.acme.defaults.email;
        firewallPorts = system.config.networking.firewall.allowedTCPPorts;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      enabled: boolean;
      package: string;
      hostname: string;
      httpHost: string;
      httpPort: number;
      databaseType: string;
      passwordFile: string;
      initialAdminPassword: string | null;
      nginxEnabled: boolean;
      forceSSL: boolean;
      enableACME: boolean;
      proxyPass: string;
      acmeEmail: string;
      firewallPorts: number[];
    };
    assert.equal(out.enabled, true);
    assert.equal(out.package, "keycloak");
    assert.equal(out.hostname, "identity.apps.kilty.io");
    assert.equal(out.httpHost, "127.0.0.1");
    assert.equal(out.httpPort, 8081);
    assert.equal(out.databaseType, "postgresql");
    assert.equal(out.passwordFile, "/var/lib/mini-secrets/keycloak-db-password");
    assert.equal(out.initialAdminPassword, null);
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.forceSSL, true);
    assert.equal(out.enableACME, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:8081");
    assert.equal(out.acmeEmail, "ops@example.com");
    assert.deepEqual(out.firewallPorts, [80, 443]);
  });
});
