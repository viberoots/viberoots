#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  assertVaultBootstrapExecutableInputs,
  buildVaultBootstrapDocument,
  buildVaultSecretTemplatesDocument,
  renderVaultBootstrapDocument,
} from "../../deployments/deployment-vault-bootstrap.ts";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture.ts";
import { installCloudflarePagesTargets } from "./deployment-targets.install.helpers.ts";
import { deploymentRequirementFixture } from "./deployment-metadata.fixture.ts";
import { runInTemp } from "../lib/test-helpers.ts";

const repoRoot = process.cwd();

function deploymentWithSecrets() {
  return cloudflarePagesDeploymentFixture({
    secretRequirements: [
      deploymentRequirementFixture({
        name: "cloudflare_api_token",
        step: "publish",
        contractId: "secret://deployments/pleomino/cloudflare_api_token",
      }),
      deploymentRequirementFixture({
        name: "preview_basic_auth_password",
        step: "smoke",
        contractId: "secret://deployments/pleomino/preview_basic_auth_password",
        required: false,
      }),
    ],
  });
}

test("deploy --print-vault-bootstrap emits deployment-derived JSON", async () => {
  await runInTemp("deploy-vault-bootstrap-json", async (tmp, $) => {
    const deployment = deploymentWithSecrets();
    await installCloudflarePagesTargets(tmp, [deployment]);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper build-tools/tools/deployments/deploy.ts \
      --deployment ${deployment.label} \
      --print-vault-bootstrap \
      --issuer-url https://identity.apps.kilty.io/realms/deployments \
      --vault-audience deployments-vault \
      --deployment-client-id deployment-runner \
      --vault-jwt-role deploy-pleomino-read`;
    const payload = JSON.parse(String(result.stdout));
    assert.equal(payload.schemaVersion, "deployment-vault-bootstrap@1");
    assert.equal(payload.deployment.repository, "kiltyj/bucknix-fresh");
    assert.equal(
      payload.deployment.providerTargetIdentity,
      "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    );
    assert.deepEqual(payload.vault.boundClaims, {
      azp: "deployment-runner",
      deployment_environment: "staging",
      repository: "kiltyj/bucknix-fresh",
    });
    const policyMatches =
      payload.policyHcl.match(/secret\/data\/deployments\/pleomino\/cloudflare_api_token/g) || [];
    assert.equal(policyMatches.length, 1);
  });
});

test("deploy read-only bootstrap path does not eagerly import provider front doors", async () => {
  const deployCliPath = path.join(repoRoot, "build-tools", "tools", "deployments", "deploy-cli.ts");
  const deployFrontDoorPath = path.join(
    repoRoot,
    "build-tools",
    "tools",
    "deployments",
    "deploy-front-door.ts",
  );
  const source = [
    await fsp.readFile(deployCliPath, "utf8"),
    await fsp.readFile(deployFrontDoorPath, "utf8"),
  ].join("\n");
  for (const providerModule of [
    "app-store-connect-front-door",
    "cloudflare-pages-front-door",
    "deploy-front-door-validate",
    "deploy-provider-front-door",
    "google-play-front-door",
    "kubernetes-front-door",
    "nixos-shared-host-remote-cli",
    "s3-static-front-door",
  ]) {
    assert.ok(
      !source.includes(`from "./${providerModule}.ts"`),
      `read-only deploy commands must not eagerly import ${providerModule}`,
    );
  }
});

test("secret templates preserve one reviewed template per requirement", () => {
  const payload = buildVaultSecretTemplatesDocument({ deployment: deploymentWithSecrets() });
  assert.equal(payload.schemaVersion, "deployment-vault-secret-templates@1");
  assert.equal(payload.templates.length, 2);
  assert.deepEqual(payload.templates[0]?.content, {
    value: "<fill-me>",
    allowedSteps: ["publish"],
    targetScopes: ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
    refreshMode: "none",
    credentialClass: "routine",
  });
  assert.equal(
    payload.templates[1]?.secretPath,
    "deployments/pleomino/preview_basic_auth_password",
  );
});

test("secret templates return an explicit no-op document for deployments without secrets", () => {
  const payload = buildVaultSecretTemplatesDocument({
    deployment: cloudflarePagesDeploymentFixture(),
  });
  assert.equal(payload.empty, true);
  assert.equal(payload.message, "deployment declares no secret requirements");
  assert.deepEqual(payload.templates, []);
});

test("Vault bootstrap fails closed for unsupported secret contract ids", () => {
  const deployment = cloudflarePagesDeploymentFixture({
    secretRequirements: [
      deploymentRequirementFixture({ contractId: "env://deployments/pleomino/token" }),
    ],
  });
  assert.throws(
    () => buildVaultBootstrapDocument({ deployment }),
    /unsupported Vault secret contract id/,
  );
});

test("executable Vault output requires operator-owned IdP and role inputs", () => {
  assert.throws(
    () => assertVaultBootstrapExecutableInputs({ issuerUrl: "https://issuer.example" }),
    /--vault-audience is required/,
  );
});

test("shell rendering includes auth, policy, role, and runtime exports", () => {
  const deployment = deploymentWithSecrets();
  const payload = buildVaultBootstrapDocument({
    deployment,
    inputs: {
      issuerUrl: "https://identity.apps.kilty.io/realms/deployments",
      audience: "deployments-vault",
      deploymentClientId: "deployment-runner",
      roleName: "deploy-pleomino-read",
      extraBoundClaims: { deployment_environment: "mini" },
    },
  });
  const rendered = renderVaultBootstrapDocument(payload, "shell");
  assert.match(rendered, /vault write auth\/jwt\/config/);
  assert.match(rendered, /vault policy write deploy-pleomino-staging-read/);
  assert.match(rendered, /vault write auth\/jwt\/role\/deploy-pleomino-read/);
  assert.match(rendered, /export BNX_VAULT_AUTH_METHOD=jwt/);
  assert.equal(payload.vault.boundClaims.deployment_environment, "mini");
});
