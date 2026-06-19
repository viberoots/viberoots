#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsRepoPath } from "./deployment-command";

test("Vault bootstrap runbook uses reviewed shared-host IdP module and JWT helper", async () => {
  const doc = await fsp.readFile(viberootsRepoPath("docs/vault-production-bootstrap.md"), "utf8");
  assert.match(doc, /shared-host-identity-provider-module\.nix/);
  assert.match(doc, /deploymentHost\.identityProvider/);
  assert.match(doc, /deploymentHost\.vault/);
  assert.match(doc, /complete Vault service wiring for the recommended module path/);
  assert.doesNotMatch(doc, /viberoots\.mini/);
  assert.doesNotMatch(doc, /mini-(identity-provider|postgres|vault)-module\.nix/);
  assert.doesNotMatch(doc, /If you do not import the module/);
  assert.doesNotMatch(doc, /minimal host where/);
  assert.doesNotMatch(doc, /manageNginx = true/);
  assert.doesNotMatch(doc, /manageAcme = true/);
  assert.doesNotMatch(doc, /openFirewall = true/);
  assert.doesNotMatch(doc, /Add Keycloak To The `mini` Flake/);
  assert.doesNotMatch(doc, /services\.nginx\.virtualHosts\.\$\{identityDomain\} =/);
  assert.doesNotMatch(doc, /^\s*\/srv\/common\/build-tools\/tools\/nix\/shared-host-/m);
  assert.doesNotMatch(doc, /url = "path:\/srv\/common";/);
  assert.match(
    doc,
    /inputs\.deploymentModules = \{[\s\S]*url = "path:\/srv\/viberoots\/build-tools\/tools\/nix";[\s\S]*flake = false;/,
  );
  assert.match(doc, /deploymentModulesRoot = deploymentModules/);
  assert.match(doc, /\$\{deploymentModulesRoot\}\/shared-host-vault-module\.nix/);
  assert.match(doc, /\$\{deploymentModulesRoot\}\/shared-host-identity-provider-module\.nix/);
  assert.match(doc, /deploy-vault-jwt \\/);
  assert.match(doc, /--client-secret-env VBR_DEPLOYER_CLIENT_SECRET/);
  assert.match(doc, /--expect-claim deployment_environment=mini/);
  assert.match(doc, /permission denied[\s\S]*sys\/auth\/\*/);
  assert.match(doc, /useAcmeCertificate = true/);
  assert.match(doc, /manageNginx = false/);
  assert.match(doc, /full URL[\s\S]*hostname-backchannel-dynamic/);
  assert.match(doc, /virtualHosts = \([\s\S]*\) \/\/ \{[\s\S]*"\$\{identityDomain\}" =/);
  assert.match(doc, /useACMEHost = "apps\.kilty\.io"/);
  assert.match(doc, /identity\.apps\.kilty\.io[\s\S]*wildcard certificate/);
  assert.doesNotMatch(doc, /protocol\/openid-connect\/token" \\/);
  assert.doesNotMatch(doc, /client_secret=\$VBR_DEPLOYER_CLIENT_SECRET/);
  assert.doesNotMatch(doc, /initialAdminPassword = "replace-after-first-login"/);
});
