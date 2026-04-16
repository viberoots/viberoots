#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const usageDocPath = path.join(repoRoot, "docs", "deployments-usage.md");
const secretsUsageDocPath = path.join(repoRoot, "docs", "secrets-usage.md");
const apiDocPath = path.join(repoRoot, "docs", "deployment-secrets-api.md");
const vaultRunbookDocPath = path.join(repoRoot, "docs", "vault-production-bootstrap.md");
const designDocPath = path.join(repoRoot, "docs", "deployments-design.md");
const scenariosDocPath = path.join(repoRoot, "docs", "deployment-scenarios.md");
const contractDocPath = path.join(repoRoot, "docs", "deployments-contract.md");
const providerCapabilitiesDocPath = path.join(
  repoRoot,
  "docs",
  "deployment-provider-capabilities.md",
);
const defsPath = path.join(repoRoot, "build-tools", "deployments", "defs.bzl");

const bannedDocFragments = [
  "deploy <deployment-id>",
  '`deployment(name = "deploy", ...)`',
  "`deployment(...)`",
  "cloudflare_static_pwa_deployment(",
  "single_component_deployment(",
  'load("//build-tools/deploy:',
  "//build-tools/deploy/",
] as const;

async function read(filePath: string): Promise<string> {
  return await fsp.readFile(filePath, "utf8");
}

function assertBannedFragmentsAbsent(doc: string, label: string) {
  for (const fragment of bannedDocFragments) {
    assert.ok(!doc.includes(fragment), `${label} must not contain stale fragment: ${fragment}`);
  }
}

test("deployment design and scenario docs stay aligned with the reviewed front door and authoring surface", async () => {
  const [
    usageDoc,
    secretsUsageDoc,
    apiDoc,
    vaultRunbookDoc,
    designDoc,
    scenariosDoc,
    contractDoc,
    providerCapabilitiesDoc,
    defs,
  ] = await Promise.all([
    read(usageDocPath),
    read(secretsUsageDocPath),
    read(apiDocPath),
    read(vaultRunbookDocPath),
    read(designDocPath),
    read(scenariosDocPath),
    read(contractDocPath),
    read(providerCapabilitiesDocPath),
    read(defsPath),
  ]);

  assertBannedFragmentsAbsent(designDoc, "deployment design");
  assertBannedFragmentsAbsent(scenariosDoc, "deployment scenarios");
  assertBannedFragmentsAbsent(contractDoc, "deployment contract");
  assertBannedFragmentsAbsent(usageDoc, "deployments usage");

  assert.match(
    designDoc,
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    "deployment design must document the reviewed --deployment <label> front door",
  );
  assert.match(
    scenariosDoc,
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    "deployment scenarios must use the reviewed --deployment <label> front door",
  );
  for (const command of [
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    /--preview\s+\\?\s*--source-run-id <deploy-run-id>/,
    /--preview-cleanup\s+\\?\s*--source-run-id <deploy-run-id>/,
    /--publish-only\s+\\?\s*--source-run-id <deploy-run-id>/,
    /--rollback/,
    /--provision-only\s+\\?\s*--source-run-id <deploy-run-id>/,
    /--retire-target\s+\\?\s*--target-exception-ref <label>/,
    /--migrate-target\s+\\?\s*--target-exception-ref <label>/,
    /--status/,
    /--print-run-lock-scope/,
    /--approve/,
  ]) {
    assert.match(
      usageDoc,
      command,
      `deployments usage must include reviewed operator workflow ${String(command)}`,
    );
  }
  for (const provider of [
    "nixos-shared-host",
    "cloudflare-pages",
    "s3-static",
    "kubernetes",
    "app-store-connect",
    "google-play",
  ]) {
    assert.match(
      usageDoc,
      new RegExp(`\`${provider}\``),
      `deployments usage must include ${provider} in the provider family quick starts`,
    );
  }
  assert.match(
    usageDoc,
    /NixOS Shared Host Usage/,
    "deployments usage must link to the provider-specific mini host usage guide",
  );
  assert.match(
    usageDoc,
    /Deployment And Secrets API/,
    "deployments usage must link to the shared deployment and secrets API reference",
  );
  assert.match(
    secretsUsageDoc,
    /Deployment And Secrets API/,
    "secrets usage must link to the shared deployment and secrets API reference",
  );
  assert.match(
    secretsUsageDoc,
    /Vault Production Bootstrap Runbook/,
    "secrets usage must link to the production Vault bootstrap runbook",
  );
  for (const fragment of [
    /End-To-End Example/,
    /cloudflare_pages_static_webapp_deployment\(/,
    /cloudflare_api_token/,
    /BNX_DEPLOYMENT_VAULT_FIXTURE_PATH/,
    /What Happens At Runtime/,
    /They do not store the secret value/,
    /allowedSteps/,
    /targetScopes/,
    /lockScope/,
    /provider target identity/i,
    /--print-target-identity/,
    /--print-run-lock-scope/,
    /refreshMode/,
    /credentialClass/,
    /step = "publish"/,
    /step = "smoke"/,
    /step = "provision"/,
    /required = "true"/,
    /required = "false"/,
  ]) {
    assert.match(
      secretsUsageDoc,
      fragment,
      `secrets usage must include ${String(fragment)} in the end-to-end secret walkthrough`,
    );
  }
  for (const fragment of [
    /deploy --list/,
    /deploy --deployment \/\/projects\/deployments\/pleomino-prod:deploy/,
    /\/api\/v1\/submissions/,
    /\/api\/v1\/status/,
    /\/api\/v1\/records/,
    /\/api\/v1\/run-actions/,
    /deployment-control-plane-submit-response@1/,
    /deployment-control-plane-run-action-request@1/,
    /nixos-shared-host-control-plane-submit-request@1/,
    /cloudflare-pages-control-plane-submit-request@1/,
    /DeploymentSecretContractBinding/,
    /createDeploymentSecretRuntime\(\)/,
    /createVaultDeploymentSecretRuntime\(\)/,
    /BNX_DEPLOYMENT_VAULT_FIXTURE_PATH/,
    /admittedContext\.targetEnvironment\.lockScope/,
    /providerTargetIdentity/,
    /--print-target-identity/,
    /--print-run-lock-scope/,
    /--status/,
    /--approve/,
    /Vault Production Bootstrap Runbook/,
  ]) {
    assert.match(apiDoc, fragment, `deployment and secrets API doc must cover ${String(fragment)}`);
  }
  for (const fragment of [
    /current deployment runtime does not read Vault directly/i,
    /BNX_DEPLOYMENT_VAULT_FIXTURE_PATH/,
    /targetScopes/,
    /lockScope/,
    /--print-target-identity/,
    /--print-run-lock-scope/,
    /vault operator init/,
    /vault audit enable file/,
    /vault secrets enable -path=secret kv-v2/,
    /vault auth enable approle/,
    /vault policy write deploy-pleomino-read/,
    /vault kv put -mount=secret/,
    /secret:\/\/deployments\/pleomino\/cloudflare_api_token/,
  ]) {
    assert.match(
      vaultRunbookDoc,
      fragment,
      `Vault production bootstrap runbook must include ${String(fragment)}`,
    );
  }
  assert.match(
    designDoc,
    /Deployments Usage/,
    "deployment design must link to the reviewed usage front door",
  );
  assert.match(
    scenariosDoc,
    /Deployments Usage/,
    "deployment scenarios must link to the reviewed usage front door",
  );
  assert.match(
    providerCapabilitiesDoc,
    /Deployments Usage/,
    "deployment provider capabilities doc must link to the reviewed usage front door",
  );
  assert.match(
    designDoc,
    /cloudflare_pages_static_webapp_deployment\(/,
    "deployment design must show the reviewed Cloudflare Pages authoring helper",
  );
  assert.match(
    designDoc,
    /deployment_target\(/,
    "deployment design must show the reviewed low-level deployment_target rule",
  );
  for (const symbol of [
    "deployment_target",
    "cloudflare_pages_static_webapp_deployment",
    "nixos_shared_host_static_webapp_deployment",
    "nixos_shared_host_ssr_webapp_deployment",
    "nixos_shared_host_multi_static_webapp_deployment",
    "s3_static_webapp_deployment",
  ]) {
    assert.match(defs, new RegExp(`\\b${symbol}\\b`), `defs.bzl must export ${symbol}`);
  }
});
