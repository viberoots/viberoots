#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractCloudflarePagesDeployments } from "../../deployments/contract";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const ATTRS =
  "name,rule_type,buck.type,provider,component,component_kind,publisher,publisher_config,protection_class,lane_policy,environment_stage,admission_policy,provider_target,vault_runtime,preview,prerequisites,secret_requirements,runtime_config_requirements,release_actions,target_exceptions,governance_policy,defaults,default_client_profile,scm_backend,repository,branch_protections,stages,stage_branches,allowed_promotion_edges,artifact_reuse_mode,promotion_compatibility,allowed_refs,required_checks,required_approvals,retry_branch_policy,retry_approval_reuse,artifact_attestation_mode,labels".split(
    ",",
  );

function assertCloudflareApiTokenSteps(
  deployment: {
    secretRequirements: Array<{
      name: string;
      step: string;
      contractId: string;
      required: boolean;
    }>;
  },
  expectedSteps = ["preview_cleanup", "publish"],
) {
  const expected = expectedSteps
    .map((step) => [step, "secret://deployments/pleomino/cloudflare_api_token", true])
    .sort();
  assert.deepEqual(
    deployment.secretRequirements
      .filter((requirement) => requirement.name === "cloudflare_api_token")
      .map((requirement) => [requirement.step, requirement.contractId, requirement.required])
      .sort(),
    expected,
  );
}

const EXPECTED_MINI_VAULT_RUNTIME_BASE = {
  addr: "https://secrets.apps.kilty.io:8200",
  oidcIssuer: "https://identity.apps.kilty.io/realms/deployments",
  audience: "deployments-vault",
  deploymentClientId: "deployment-runner",
  cliPublicClientId: "deployment-cli",
  serviceAccountClientId: "deployment-runner",
  deploymentEnvironment: "mini",
  roleName: "deploy-pleomino-read",
  pkceCallback: {
    mode: "public_host",
    externalScheme: "https",
    externalHost: "deploy-auth.apps.kilty.io",
    externalPath: "/oidc/callback",
    bindHost: "127.0.0.1",
    bindPort: "7780",
    bindPath: "/oidc/callback",
  },
};
test("cloudflare-pages deployment extraction reads canonical metadata from TARGETS via cquery", async () => {
  await runInTemp("cloudflare-pages-cquery-extraction", async (tmp, _$) => {
    const appTargetsPath = path.join(tmp, "projects/apps/pleomino/TARGETS");
    const deployTargetsPath = path.join(tmp, "projects/deployments/pleomino-staging/TARGETS");
    const sharedTargetsPath = path.join(tmp, "projects/deployments/pleomino-shared/TARGETS");
    await fsp.mkdir(path.dirname(appTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
    await fsp.mkdir(path.dirname(sharedTargetsPath), { recursive: true });
    await fsp.writeFile(
      appTargetsPath,
      [
        'load("@prelude//:rules.bzl", "genrule")',
        "",
        "genrule(",
        '    name = "app",',
        '    out = "app.txt",',
        '    cmd = "printf pleomino > $OUT",',
        '    labels = ["kind:app", "webapp:static"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      sharedTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_defaults", "deployment_lane_governance", "deployment_lane_policy")',
        "",
        "deployment_defaults(",
        '    name = "defaults",',
        '    default_client_profile = "mini",',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "deployment_lane_governance(",
        '    name = "lane_governance",',
        '    scm_backend = "github",',
        '    repository = "viberoots/viberoots",',
        "    branch_protections = [",
        '        {"stage": "dev", "branch": "env/pleomino/dev", "required_checks": "deploy/pleomino-dev", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
        '        {"stage": "staging", "branch": "env/pleomino/staging", "required_checks": "deploy/pleomino-staging", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
        '        {"stage": "prod", "branch": "env/pleomino/prod", "required_checks": "deploy/pleomino-prod", "fast_forward_only": "true", "normal_advance_principals": "app:deploy-bot", "emergency_direct_push_principals": "team:sre-break-glass"},',
        "    ],",
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "deployment_lane_policy(",
        '    name = "lane",',
        '    defaults = ":defaults",',
        '    stages = ["dev", "staging", "prod"],',
        '    stage_branches = {"dev": "env/pleomino/dev", "staging": "env/pleomino/staging", "prod": "env/pleomino/prod"},',
        '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
        '    promotion_compatibility = """{"cross_provider_promotion_edges":["dev->staging"]}""",',
        '    governance_policy = ":lane_governance",',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
        "deployment_admission_policy(",
        '    name = "staging_release",',
        '    allowed_refs = ["env/pleomino/staging"],',
        '    required_checks = ["deploy/pleomino-staging"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    await fsp.writeFile(
      deployTargetsPath,
      [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
        "",
        "cloudflare_pages_static_webapp_deployment(",
        '    name = "deploy",',
        '    component = "//projects/apps/pleomino:app",',
        '    account = "web-platform-staging",',
        '    custom_domain = "staging.pleomino.com",',
        '    custom_domain_zone_id = "zone-pleomino",',
        '    project = "pleomino-staging-pages",',
        '    lane_policy = "//projects/deployments/pleomino-shared:lane",',
        '    environment_stage = "staging",',
        '    admission_policy = "//projects/deployments/pleomino-shared:staging_release",',
        "    secret_requirements = [",
        "        {",
        '            "name": "cloudflare_api_token",',
        '            "step": "provision",',
        '            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",',
        '            "required": "true",',
        "        },",
        "        {",
        '            "name": "cloudflare_api_token",',
        '            "step": "publish",',
        '            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",',
        '            "required": "true",',
        "        },",
        "        {",
        '            "name": "cloudflare_api_token",',
        '            "step": "preview_cleanup",',
        '            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",',
        '            "required": "true",',
        "        },",
        "    ],",
        "    runtime_config_requirements = [],",
        "    preview = {",
        '        "target_derivation": "provider_managed_source_run",',
        '        "isolation_class": "isolated",',
        '        "identity_selector": "source_run",',
        '        "cleanup_ttl": "7d",',
        '        "smoke_target": "preview_url",',
        '        "lock_scope": "shared",',
        "    },",
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/pleomino-staging:deploy //projects/apps/pleomino:app //projects/deployments/pleomino-shared:lane //projects/deployments/pleomino-shared:defaults //projects/deployments/pleomino-shared:lane_governance //projects/deployments/pleomino-shared:staging_release)";
    const cquery = await _$({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("cloudflare-pages-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
    const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
    const { deployments, errors } = extractCloudflarePagesDeployments(nodesFromCqueryJson(merged));
    assert.deepEqual(errors, []);
    assert.equal(deployments.length, 1);
    assert.equal(deployments[0]?.label, "//projects/deployments/pleomino-staging:deploy");
    assert.equal(deployments[0]?.lanePolicy.defaultClientProfile, "mini");
    assert.equal(deployments[0]?.publisher.config, "wrangler.jsonc");
    assert.equal(deployments[0]?.providerTarget.account, "web-platform-staging");
    assert.equal(deployments[0]?.providerTarget.project, "pleomino-staging-pages");
    assert.equal(deployments[0]?.providerTarget.customDomain, "staging.pleomino.com");
    assert.equal(deployments[0]?.providerTarget.customDomainZoneId, "zone-pleomino");
    assert.equal(deployments[0]?.providerTarget.canonicalUrl, "https://staging.pleomino.com/");
    assert.deepEqual(deployments[0]?.prerequisites, []);
    assert.equal(deployments[0]?.preview?.identitySelector, "source_run");
    assertCloudflareApiTokenSteps(deployments[0]!, ["preview_cleanup", "provision", "publish"]);
  });
});

test("concrete Pleomino Cloudflare TARGETS emit publish and cleanup token requirements", async () => {
  const attrFlags = ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query =
    "set(//projects/deployments/pleomino-staging:deploy //projects/deployments/pleomino-prod:deploy //projects/apps/pleomino:app //projects/deployments/pleomino-shared:lane //projects/deployments:defaults //projects/deployments/pleomino-shared:lane_governance //projects/deployments/pleomino-shared:staging_release //projects/deployments/pleomino-shared:prod_release)";
  const cquery = await $({
    stdio: "pipe",
    env: {
      ...process.env,
      HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
      SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
    },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("cloudflare-pages-pleomino-cquery")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`.quiet();
  const merged = JSON.parse(String(cquery.stdout || "")) as Record<string, any>;
  const { deployments, errors } = extractCloudflarePagesDeployments(nodesFromCqueryJson(merged));
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, 2);
  assert.equal(
    deployments.find((deployment) => deployment.deploymentId === "pleomino-staging")?.providerTarget
      .accountId,
    "1b911846f80a89272c0dbaf44f5c810f",
  );
  for (const deployment of deployments)
    assert.equal(deployment.lanePolicy.defaultClientProfile, "mini");
  const staging = deployments.find((deployment) => deployment.deploymentId === "pleomino-staging");
  const prod = deployments.find((deployment) => deployment.deploymentId === "pleomino-prod");
  assert.equal(staging?.providerTarget.customDomain, "staging.pleomino.com");
  assert.equal(staging?.providerTarget.customDomainZoneId, "9411ac5903acb1c2e29b3d4c04ef7e6f");
  assert.equal(staging?.providerTarget.canonicalUrl, "https://staging.pleomino.com/");
  assert.equal(prod?.providerTarget.accountId, "1b911846f80a89272c0dbaf44f5c810f");
  assert.equal(prod?.providerTarget.customDomain, "pleomino.com");
  assert.equal(prod?.providerTarget.customDomainZoneId, "9411ac5903acb1c2e29b3d4c04ef7e6f");
  assert.equal(prod?.providerTarget.canonicalUrl, "https://pleomino.com/");
  assertCloudflareApiTokenSteps(staging!, ["preview_cleanup", "provision", "publish"]);
  assertCloudflareApiTokenSteps(prod!, ["preview_cleanup", "provision", "publish"]);
  assert.deepEqual(
    deployments
      .map((deployment) => deployment.vaultRuntime)
      .sort((a, b) => String(a?.roleName || "").localeCompare(String(b?.roleName || ""))),
    [EXPECTED_MINI_VAULT_RUNTIME_BASE, EXPECTED_MINI_VAULT_RUNTIME_BASE],
  );
});
