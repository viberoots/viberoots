#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";

export const CLOUDFLARE_EXTRACTION_QUERY =
  "set(//projects/deployments/sample-webapp/staging:deploy //projects/apps/sample-webapp:app //projects/deployments/sample-webapp/shared:lane //projects/deployments/sample-webapp/shared:defaults //projects/deployments/sample-webapp/shared:lane_governance //projects/deployments/sample-webapp/shared:staging_release)";

export async function writeCloudflarePagesExtractionFixture(
  tmp: string,
  opts: { infisical?: boolean } = {},
): Promise<void> {
  const appTargetsPath = path.join(tmp, "projects/apps/sample-webapp/TARGETS");
  const deployTargetsPath = path.join(tmp, "projects/deployments/sample-webapp/staging/TARGETS");
  const sharedTargetsPath = path.join(tmp, "projects/deployments/sample-webapp/shared/TARGETS");
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
      '    cmd = "printf sample-webapp > $OUT",',
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
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_defaults", "deployment_lane_governance", "deployment_lane_policy")',
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
      "    source_ref_policies = [",
      '        {"stage": "dev", "allowed_refs": "main", "required_checks": "deploy/sample-webapp-dev"},',
      '        {"stage": "staging", "allowed_refs": "main,refs/tags/release/*", "required_checks": "deploy/sample-webapp-staging"},',
      '        {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/sample-webapp-prod"},',
      "    ],",
      '    trusted_reporter_identities = ["app:deploy-bot", "ci:jenkins"],',
      '    required_approval_boundaries = [{"stage": "prod", "required_approvals": "release-owner"}],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_lane_policy(",
      '    name = "lane",',
      '    defaults = ":defaults",',
      '    stages = ["dev", "staging", "prod"],',
      '    source_ref_policy = {"dev": "main", "staging": "main", "prod": "refs/tags/release/*"},',
      '    allowed_promotion_edges = ["dev->staging", "staging->prod"],',
      '    promotion_compatibility = """{"cross_provider_promotion_edges":["dev->staging"]}""",',
      '    governance_policy = ":lane_governance",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_admission_policy(",
      '    name = "staging_release",',
      '    allowed_refs = ["main", "refs/tags/release/*"],',
      '    required_checks = ["deploy/sample-webapp-staging"],',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.writeFile(
    deployTargetsPath,
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
      "",
      "cloudflare_pages_static_webapp_deployment(",
      '    name = "deploy",',
      '    component = "//projects/apps/sample-webapp:app",',
      '    account = "web-platform-staging",',
      '    account_id = "11111111111111111111111111111111",',
      '    custom_domain = "staging.sample-webapp.com",',
      '    custom_domain_zone_id = "zone-sample-webapp",',
      '    project = "sample-webapp-staging-pages",',
      '    lane_policy = "//projects/deployments/sample-webapp/shared:lane",',
      '    environment_stage = "staging",',
      '    admission_policy = "//projects/deployments/sample-webapp/shared:staging_release",',
      ...(opts.infisical
        ? [
            '    secret_backend = "infisical/default",',
            "    infisical_runtime = {",
            '        "site_url": "http://127.0.0.1",',
            '        "project_id": "proj_123",',
            '        "environment": "staging",',
            '        "secret_path": "/deployments/sample-webapp/staging",',
            '        "preferred_credential_source": "infisical_machine_identity_universal_auth",',
            '        "machine_identity_client_id_env": "INFISICAL_CLIENT_ID",',
            '        "machine_identity_client_secret_env": "INFISICAL_CLIENT_SECRET",',
            "    },",
          ]
        : []),
      "    secret_requirements = [",
      "        {",
      '            "name": "cloudflare_api_token",',
      '            "step": "provision",',
      '            "contract_id": "secret://deployments/sample-webapp/cloudflare_api_token",',
      '            "required": "true",',
      "        },",
      "        {",
      '            "name": "cloudflare_api_token",',
      '            "step": "publish",',
      '            "contract_id": "secret://deployments/sample-webapp/cloudflare_api_token",',
      '            "required": "true",',
      "        },",
      "        {",
      '            "name": "cloudflare_api_token",',
      '            "step": "preview_cleanup",',
      '            "contract_id": "secret://deployments/sample-webapp/cloudflare_api_token",',
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
}
