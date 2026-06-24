#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pinnedNixpkgsOutPathExpr } from "../../lib/pinned-nixpkgs";
import { viberootsRepoPath } from "./deployment-command";

const flakeLockPath = viberootsRepoPath("flake.lock");
const pinnedNixpkgsPathExpr = pinnedNixpkgsOutPathExpr(flakeLockPath);

async function evalNixJson<T>(expr: string): Promise<T> {
  const result = await $({
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`nix eval --impure --expr ${expr} --json`;
  assert.equal(
    result.exitCode,
    0,
    `nix eval failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return JSON.parse(String(result.stdout || "{}")) as T;
}

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
  const expr = `
      let
        nixpkgsPath = ${pinnedNixpkgsPathExpr};
        system = import (nixpkgsPath + "/nixos") {
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
  const out = await evalNixJson<{
    enabled: boolean;
    package: string;
    listen: string;
    port: number;
    databases: string[];
    users: Array<{ name: string; ensureDBOwnership: boolean }>;
  }>(expr);
  assert.equal(out.enabled, true);
  assert.equal(out.package, "postgresql");
  assert.equal(out.listen, "127.0.0.1");
  assert.equal(out.port, 5432);
  assert.deepEqual(out.databases, ["deployctl"]);
  assert.deepEqual(out.users, [{ name: "deployctl", ensureDBOwnership: true }]);
});

test("shared-host vault module evaluates as an importable reviewed host module", async () => {
  const expr = `
      let
        nixpkgsPath = ${pinnedNixpkgsPathExpr};
        system = import (nixpkgsPath + "/nixos") {
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
  const out = await evalNixJson<{
    enabled: boolean;
    package: string;
    address: string;
    storageBackend: string;
    storagePath: string;
  }>(expr);
  assert.equal(out.enabled, true);
  assert.equal(out.package, "vault");
  assert.equal(out.address, "127.0.0.1:8200");
  assert.equal(out.storageBackend, "raft");
  assert.equal(out.storagePath, "/var/lib/vault");
});

test("shared-host vault module can augment an existing apps ACME host config", async () => {
  const expr = `
      let
        nixpkgsPath = ${pinnedNixpkgsPathExpr};
        system = import (nixpkgsPath + "/nixos") {
          configuration = {
            imports = [ ${viberootsRepoPath("viberoots/build-tools/tools/nix/shared-host-vault-module.nix")} ];
            system.stateVersion = "24.11";
            security.acme.certs."wildcard.example.test" = {
              domain = "*.example.test";
              extraDomainNames = [ "example.test" ];
              dnsProvider = "route53";
              credentialFiles = {
                AWS_SHARED_CREDENTIALS_FILE = "/root/aws-credentials";
              };
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
  const out = await evalNixJson<{
    address: string;
    tlsCertFile: string;
    tlsKeyFile: string;
    extraConfig: string;
    listenerExtraConfig: string;
    acmeGroup: string;
    acmeMembers: string[];
    firewallPorts: number[];
    localHosts: string[];
  }>(expr);
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
