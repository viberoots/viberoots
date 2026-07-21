#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  ensureParentDir,
  writeStaticWebappTarget,
} from "./nixos-shared-host.extraction.from-targets.helpers";
import { reconcileSyntheticDeploymentGraph } from "./deployment-graph.fixture";

export const CUTOVER_FAMILY = "cutover-demo";
export const CUTOVER_APP = `//projects/apps/${CUTOVER_FAMILY}:app`;
export const CUTOVER_SHARED = `//projects/deployments/${CUTOVER_FAMILY}/shared`;
export const CUTOVER_DEV = `//projects/deployments/${CUTOVER_FAMILY}/dev:deploy`;
export const CUTOVER_STAGING = `//projects/deployments/${CUTOVER_FAMILY}/staging:deploy`;
export const CUTOVER_PROD = `//projects/deployments/${CUTOVER_FAMILY}/prod:deploy`;
export const CUTOVER_TOKEN_CONTRACT = `secret://deployments/${CUTOVER_FAMILY}/cloudflare_api_token`;
export const CUTOVER_PROJECT_ID = "cutover_proj_live";
export const CUTOVER_INFISICAL_IDENTITIES = {
  staging: "cutover-staging-identity",
  prod: "cutover-prod-identity",
};

export const CUTOVER_QUERY_LABELS = [
  CUTOVER_DEV,
  CUTOVER_STAGING,
  CUTOVER_PROD,
  CUTOVER_APP,
  `${CUTOVER_SHARED}:defaults`,
  `${CUTOVER_SHARED}:lane`,
  `${CUTOVER_SHARED}:lane_governance`,
  `${CUTOVER_SHARED}:dev_release`,
  `${CUTOVER_SHARED}:staging_release`,
  `${CUTOVER_SHARED}:prod_release`,
];

export async function writeCutoverDeploymentFixture(tmp: string): Promise<void> {
  await writeStaticWebappTarget(
    path.join(tmp, "projects", "apps", CUTOVER_FAMILY, "TARGETS"),
    "app",
  );
  await writeSharedTargets(tmp);
  await writeDevTarget(tmp);
  await writeCloudflareTarget(tmp, "staging", "shared_nonprod", CUTOVER_STAGING);
  await writeCloudflareTarget(tmp, "prod", "production_facing", CUTOVER_PROD);
  await reconcileSyntheticDeploymentGraph(tmp);
}

async function writeSharedTargets(tmp: string): Promise<void> {
  const filePath = path.join(tmp, "projects", "deployments", CUTOVER_FAMILY, "shared", "TARGETS");
  await ensureParentDir(filePath);
  await fsp.writeFile(
    filePath,
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_defaults", "deployment_lane_governance", "deployment_lane_policy")',
      'deployment_defaults(name = "defaults", default_client_profile = "mini", visibility = ["PUBLIC"])',
      'deployment_lane_governance(name = "lane_governance", scm_backend = "github", repository = "viberoots/viberoots", source_ref_policies = [{"stage": "dev", "allowed_refs": "main", "required_checks": "deploy/cutover-dev"}, {"stage": "staging", "allowed_refs": "main", "required_checks": "deploy/cutover-staging"}, {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/cutover-prod"}], trusted_reporter_identities = ["app:deploy-bot"], required_approval_boundaries = [{"stage": "prod", "required_approvals": "release-owner"}], visibility = ["PUBLIC"])',
      'deployment_lane_policy(name = "lane", defaults = ":defaults", stages = ["dev", "staging", "prod"], source_ref_policy = {"dev": "main", "staging": "main", "prod": "refs/tags/release/*"}, allowed_promotion_edges = ["dev->staging", "staging->prod"], governance_policy = ":lane_governance", visibility = ["PUBLIC"])',
      'deployment_admission_policy(name = "dev_release", allowed_refs = ["main"], required_checks = ["deploy/cutover-dev"], visibility = ["PUBLIC"])',
      'deployment_admission_policy(name = "staging_release", allowed_refs = ["main"], required_checks = ["deploy/cutover-staging"], visibility = ["PUBLIC"])',
      'deployment_admission_policy(name = "prod_release", allowed_refs = ["refs/tags/release/*"], required_checks = ["deploy/cutover-prod"], required_approvals = ["release-owner"], visibility = ["PUBLIC"])',
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeDevTarget(tmp: string): Promise<void> {
  const filePath = path.join(tmp, "projects", "deployments", CUTOVER_FAMILY, "dev", "TARGETS");
  await ensureParentDir(filePath);
  await fsp.writeFile(
    filePath,
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "nixos_shared_host_static_webapp_deployment")',
      'nixos_shared_host_static_webapp_deployment(name = "deploy", component = "' +
        CUTOVER_APP +
        '", lane_policy = "' +
        `${CUTOVER_SHARED}:lane` +
        '", environment_stage = "dev", admission_policy = "' +
        `${CUTOVER_SHARED}:dev_release` +
        '", app_name = "' +
        CUTOVER_FAMILY +
        '", container_port = 3000, protection_class = "shared_nonprod", vault_runtime = ' +
        JSON.stringify(cutoverVaultRuntime()) +
        ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function writeCloudflareTarget(
  tmp: string,
  stage: "staging" | "prod",
  protectionClass: string,
  label: string,
): Promise<void> {
  const dir = path.join(tmp, "projects", "deployments", CUTOVER_FAMILY, stage);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "wrangler.jsonc"), minimalWranglerConfig(), "utf8");
  await fsp.writeFile(
    path.join(dir, "TARGETS"),
    cloudflareTarget(stage, protectionClass, label),
    "utf8",
  );
}

function cloudflareTarget(
  stage: "staging" | "prod",
  protectionClass: string,
  label: string,
): string {
  const project = `${CUTOVER_FAMILY}-${stage}-pages`;
  const envPrefix = `CUTOVER_${stage.toUpperCase()}_INFISICAL`;
  const identity = CUTOVER_INFISICAL_IDENTITIES[stage];
  const admission = `${CUTOVER_SHARED}:${stage}_release`;
  return [
    'load("@viberoots//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
    'cloudflare_pages_static_webapp_deployment(name = "deploy", component = "' +
      CUTOVER_APP +
      '", account = "web-platform", account_id = "11111111111111111111111111111111", project = "' +
      project +
      '", custom_domain = "' +
      `${stage}.${CUTOVER_FAMILY}.example.test` +
      '", custom_domain_zone_id = "zone-cutover", lane_policy = "' +
      `${CUTOVER_SHARED}:lane` +
      '", environment_stage = "' +
      stage +
      '", admission_policy = "' +
      admission +
      '", protection_class = "' +
      protectionClass +
      '", external_requirement_profiles = ["cloudflare_provider"], secret_backend = "infisical/default", secret_requirements = ' +
      JSON.stringify(secretRequirements()) +
      ", infisical_runtime = " +
      JSON.stringify({
        site_url: "https://app.infisical.com",
        project_id: CUTOVER_PROJECT_ID,
        project_name: "cutover-demo-deployments",
        project_slug: "cutover-demo-deployments",
        environment: stage,
        secret_path: "/",
        preferred_credential_source: "infisical_machine_identity_universal_auth",
        machine_identity_client_id_env: `${envPrefix}_CLIENT_ID`,
        machine_identity_client_secret_env: `${envPrefix}_CLIENT_SECRET`,
        machine_identity_client_id_file_name: `${CUTOVER_FAMILY}-${stage}-infisical-client-id`,
        machine_identity_client_secret_file_name: `${CUTOVER_FAMILY}-${stage}-infisical-client-secret`,
        machine_identity_id: identity,
      }) +
      ")",
    "",
  ].join("\n");
}

function secretRequirements() {
  return ["provision", "publish", "preview_cleanup"].map((step) => ({
    name: "cloudflare_api_token",
    step,
    contract_id: CUTOVER_TOKEN_CONTRACT,
    required: "true",
  }));
}

function cutoverVaultRuntime() {
  return {
    addr: "https://vault.example.test",
    oidc_issuer: "https://issuer.example.test",
    audience: "deployments-vault",
    deployment_client_id: "deployment-runner",
    service_account_client_id: "deployment-runner",
    cli_public_client_id: "deployment-cli",
    deployment_environment: "mini",
    jwt_role: "deploy-cutover-read",
    pkce_callback_mode: "public_host",
    pkce_callback_external_scheme: "https",
    pkce_callback_external_host: "deploy-auth.apps.kilty.io",
    pkce_callback_external_path: "/oidc/callback",
    pkce_callback_bind_host: "127.0.0.1",
    pkce_callback_bind_port: "7780",
    pkce_callback_bind_path: "/oidc/callback",
  };
}

export function minimalWranglerConfig(): string {
  return `{
  "$schema": "../../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
`;
}
