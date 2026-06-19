#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsRepoPath } from "./deployment-command";

test("shared-host service modules do not hardcode a public deployment domain", async () => {
  const moduleDir = viberootsRepoPath("build-tools/tools/nix");
  const moduleTexts = await Promise.all(
    [
      "shared-host-vault-module.nix",
      "shared-host-identity-provider-module.nix",
      "shared-host-deployment-service-module.nix",
      "shared-host-deploy-auth-callback-module.nix",
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
            imports = [ ${viberootsRepoPath("viberoots/build-tools/tools/nix/shared-host-postgres-module.nix")} ];
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
            imports = [ ${viberootsRepoPath("viberoots/build-tools/tools/nix/shared-host-vault-module.nix")} ];
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
            imports = [ ${viberootsRepoPath("viberoots/build-tools/tools/nix/shared-host-vault-module.nix")} ];
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
