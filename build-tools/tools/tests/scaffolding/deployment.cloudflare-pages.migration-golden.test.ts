#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const wranglerShape = `{
  "$schema": "../../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
`;

const deployments = [
  {
    id: "pleomino-staging",
    account: "web-platform-staging",
    accountId: "1b911846f80a89272c0dbaf44f5c810f",
    domain: "staging.pleomino.com",
    zoneId: "9411ac5903acb1c2e29b3d4c04ef7e6f",
    project: "pleomino-staging-pages",
    stage: "staging",
    protectionClass: "shared_nonprod",
    prerequisiteId: "pleomino-dev",
  },
  {
    id: "pleomino-prod",
    account: "web-platform-prod",
    accountId: "1b911846f80a89272c0dbaf44f5c810f",
    domain: "pleomino.com",
    zoneId: "9411ac5903acb1c2e29b3d4c04ef7e6f",
    project: "pleomino-prod-pages",
    stage: "prod",
    protectionClass: "production_facing",
    prerequisiteId: "pleomino-staging",
  },
];

async function readDeploymentFile(deploymentId: string, file: string): Promise<string> {
  return await fsp.readFile(
    path.join(repoRoot, "projects/deployments", deploymentId, file),
    "utf8",
  );
}

function expectedTargets(deployment: (typeof deployments)[number]): string {
  return `load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")

cloudflare_pages_static_webapp_deployment(
    name = "deploy",
    component = "//projects/apps/pleomino:app",
    account = "${deployment.account}",
    account_id = "${deployment.accountId}",
    custom_domain = "${deployment.domain}",
    custom_domain_zone_id = "${deployment.zoneId}",
    project = "${deployment.project}",
    lane_policy = "//projects/deployments/pleomino-shared:lane",
    environment_stage = "${deployment.stage}",
    admission_policy = "//projects/deployments/pleomino-shared:${deployment.stage}_release",
    protection_class = "${deployment.protectionClass}",
    vault_runtime = {
        "addr": "https://secrets.apps.kilty.io:8200",
        "oidc_issuer": "https://identity.apps.kilty.io/realms/deployments",
        "audience": "deployments-vault",
        "deployment_client_id": "deployment-runner",
        "service_account_client_id": "deployment-runner",
        "cli_public_client_id": "deployment-cli",
        "deployment_environment": "mini",
        "jwt_role": "deploy-pleomino-read",
        "pkce_callback_mode": "public_host",
        "pkce_callback_external_scheme": "https",
        "pkce_callback_external_host": "deploy-auth.apps.kilty.io",
        "pkce_callback_external_path": "/oidc/callback",
        "pkce_callback_bind_host": "127.0.0.1",
        "pkce_callback_bind_port": "7780",
        "pkce_callback_bind_path": "/oidc/callback",
    },
    secret_requirements = [
        {
            "name": "cloudflare_api_token",
            "step": "provision",
            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_api_token",
            "step": "publish",
            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_api_token",
            "step": "preview_cleanup",
            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [],
    external_requirement_profiles = ["cloudflare_provider"],
    prerequisites = [
        {
            "deployment_id": "${deployment.prerequisiteId}",
            "mode": "ordering_only",
        },
    ],
    preview = {
        "target_derivation": "provider_managed_source_run",
        "isolation_class": "isolated",
        "identity_selector": "source_run",
        "cleanup_ttl": "7d",
        "smoke_target": "preview_url",
        "lock_scope": "shared",
    },
)
`;
}

test("checked-in Cloudflare Pages deployments keep scaffolded file shape", async () => {
  for (const deployment of deployments) {
    const wrangler = await readDeploymentFile(deployment.id, "wrangler.jsonc");
    assert.equal(wrangler, wranglerShape);
    assert.equal(await readDeploymentFile(deployment.id, "TARGETS"), expectedTargets(deployment));
  }
});
