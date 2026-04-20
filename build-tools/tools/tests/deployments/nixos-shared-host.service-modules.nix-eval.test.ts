#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("shared-host service modules do not hardcode a public deployment domain", async () => {
  const moduleDir = path.join(process.cwd(), "build-tools", "tools", "nix");
  const moduleTexts = await Promise.all(
    [
      "shared-host-vault-module.nix",
      "shared-host-identity-provider-module.nix",
      "shared-host-postgres-module.nix",
    ].map(async (file) => await fsp.readFile(path.join(moduleDir, file), "utf8")),
  );
  const combined = moduleTexts.join("\n");
  assert.doesNotMatch(combined, /apps\.kilty\.io/);
  assert.doesNotMatch(combined, /identity\.apps\.kilty\.io/);
  assert.doesNotMatch(combined, /secrets\.apps\.kilty\.io/);
  assert.doesNotMatch(combined, /ops@example\.com/);
});

test("shared-host postgres module evaluates as an importable reviewed host module", async () => {
  await runInTemp("shared-host-postgres-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-postgres-module.nix ];
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

test("shared-host vault module evaluates as an importable reviewed host module", async () => {
  await runInTemp("shared-host-vault-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-vault-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.vault.enable = true;
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

test("shared-host vault module can augment an existing apps ACME host config", async () => {
  await runInTemp("shared-host-vault-module-acme-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-vault-module.nix ];
            system.stateVersion = "24.11";
            security.acme.certs."wildcard.example.test" = {
              domain = "*.example.test";
              extraDomainNames = [ "example.test" ];
              dnsProvider = "route53";
              credentialsFile = "/root/aws-credentials";
            };
            deploymentHost.vault = {
              enable = true;
              address = "0.0.0.0:8200";
              useAcmeCertificate = true;
              acmeCertName = "wildcard.example.test";
              acmeGroup = "cert-readers";
              openFirewall = true;
              addLocalHostname = true;
              publicHostname = "secrets.example.test";
              apiAddress = "https://secrets.example.test:8200";
              clusterAddress = "https://vault-1.example.test:8201";
              listenerExtraConfig = "tls_min_version = \\"tls12\\"";
            };
          };
        };
      in {
        address = system.config.services.vault.address;
        tlsCertFile = system.config.services.vault.tlsCertFile;
        tlsKeyFile = system.config.services.vault.tlsKeyFile;
        extraConfig = system.config.services.vault.extraConfig;
        listenerExtraConfig = system.config.services.vault.listenerExtraConfig;
        acmeGroup = system.config.security.acme.certs."wildcard.example.test".group;
        acmeMembers = system.config.users.groups.cert-readers.members;
        firewallPorts = system.config.networking.firewall.allowedTCPPorts;
        localHosts = system.config.networking.hosts."127.0.0.1";
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      address: string;
      tlsCertFile: string;
      tlsKeyFile: string;
      extraConfig: string;
      listenerExtraConfig: string;
      acmeGroup: string;
      acmeMembers: string[];
      firewallPorts: number[];
      localHosts: string[];
    };
    assert.equal(out.address, "0.0.0.0:8200");
    assert.match(out.tlsCertFile, /\/var\/lib\/acme\/wildcard\.example\.test\/fullchain\.pem$/);
    assert.match(out.tlsKeyFile, /\/var\/lib\/acme\/wildcard\.example\.test\/key\.pem$/);
    assert.match(out.extraConfig, /api_addr = "https:\/\/secrets\.example\.test:8200"/);
    assert.match(out.extraConfig, /cluster_addr = "https:\/\/vault-1\.example\.test:8201"/);
    assert.match(out.listenerExtraConfig, /tls_min_version = "tls12"/);
    assert.equal(out.acmeGroup, "cert-readers");
    assert.deepEqual(out.acmeMembers, ["vault"]);
    assert.deepEqual(out.firewallPorts, [8200]);
    assert.deepEqual(out.localHosts, ["secrets.example.test"]);
  });
});

test("shared-host identity provider module evaluates as reviewed Keycloak defaults", async () => {
  await runInTemp("shared-host-identity-provider-module-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-identity-provider-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.identityProvider = {
              enable = true;
              hostname = "identity.example.test";
              acmeEmail = "ops@example.test";
              manageNginx = true;
              manageAcme = true;
              openFirewall = true;
            };
          };
        };
        host = system.config.deploymentHost.identityProvider.hostname;
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
    assert.equal(out.hostname, "https://identity.example.test");
    assert.equal(out.httpHost, "127.0.0.1");
    assert.equal(out.httpPort, 8081);
    assert.equal(out.databaseType, "postgresql");
    assert.equal(out.passwordFile, "/var/lib/deployment-host-secrets/keycloak-db-password");
    assert.equal(out.initialAdminPassword, null);
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.forceSSL, true);
    assert.equal(out.enableACME, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:8081");
    assert.equal(out.acmeEmail, "ops@example.test");
    assert.deepEqual(out.firewallPorts, [80, 443]);
  });
});
