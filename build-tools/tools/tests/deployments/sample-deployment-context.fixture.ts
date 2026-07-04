import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SAMPLE_CONTEXT_LABELS = [
  "//projects/apps/sample-webapp:app",
  "//projects/deployments:defaults",
  "//projects/deployments/sample-webapp/shared:lane",
  "//projects/deployments/sample-webapp/shared:lane_governance",
  "//projects/deployments/sample-webapp/shared:staging_release",
  "//projects/deployments/sample-webapp/shared:prod_release",
  "//projects/deployments/sample-webapp/staging:deploy",
  "//projects/deployments/sample-webapp/prod:deploy",
];

export const SAMPLE_CONTEXT_EXPECTED = {
  staging: {
    context: "sample-webapp-staging",
    account: "sample-platform-staging",
    project: "sample-webapp-staging-pages",
    customDomain: "staging.sample.example",
    environment: "staging",
    clientIdEnv: "SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_ID",
    clientSecretEnv: "SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_SECRET",
    clientIdRef: "secret://deployments/sample-webapp/staging/infisical-client-id",
    clientSecretRef: "secret://deployments/sample-webapp/staging/infisical-client-secret",
    clientIdFile: "sample-webapp-staging-infisical-client-id",
    clientSecretFile: "sample-webapp-staging-infisical-client-secret",
    machineIdentityId: "8b9bc77a-ad32-459f-82a9-b72cd7a3530d",
    controlPlaneUrl: "https://staging.control-plane.viberoots.example",
    controlPlaneTokenRef: "secret://control-plane/sample-webapp/staging/service-token",
  },
  prod: {
    context: "sample-webapp-prod",
    account: "sample-platform-prod",
    project: "sample-webapp-prod-pages",
    customDomain: "sample.example",
    environment: "prod",
    clientIdEnv: "SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_ID",
    clientSecretEnv: "SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_SECRET",
    clientIdRef: "secret://deployments/sample-webapp/prod/infisical-client-id",
    clientSecretRef: "secret://deployments/sample-webapp/prod/infisical-client-secret",
    clientIdFile: "sample-webapp-prod-infisical-client-id",
    clientSecretFile: "sample-webapp-prod-infisical-client-secret",
    machineIdentityId: "ceca24df-0e8b-457e-a5a8-cf20a122d2da",
    controlPlaneUrl: "https://control-plane.viberoots.example",
    controlPlaneTokenRef: "secret://control-plane/sample-webapp/prod/service-token",
  },
};

export async function writeSampleDeploymentContextFixture(
  tmp: string,
  opts: { explicitProviderValues?: boolean } = {},
) {
  await writeJson(tmp, "projects/config/shared.json", sampleProjectConfig());
  await writeFile(
    tmp,
    "projects/apps/sample-webapp/TARGETS",
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'genrule(name = "app", out = "app.txt", cmd = "printf sample > $OUT", labels = ["kind:app", "webapp:static"], visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await writeFile(
    tmp,
    "projects/deployments/TARGETS",
    [
      'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_defaults")',
      'deployment_defaults(name = "defaults", default_client_profile = "mini", visibility = ["PUBLIC"])',
    ].join("\n"),
  );
  await writeFile(tmp, "projects/deployments/sample-webapp/shared/TARGETS", sharedTargets());
  await writeFile(tmp, "projects/deployments/sample-webapp/shared/family.bzl", familyBzl());
  await writeStage(tmp, "staging", opts.explicitProviderValues === true);
  await writeStage(tmp, "prod", false);
}

export function sampleProjectConfig() {
  const expected = SAMPLE_CONTEXT_EXPECTED;
  return {
    controlPlanes: {
      [expected.staging.context]: {
        serviceClient: {
          controlPlaneUrl: expected.staging.controlPlaneUrl,
          controlPlaneTokenRef: expected.staging.controlPlaneTokenRef,
        },
      },
      [expected.prod.context]: {
        serviceClient: {
          controlPlaneUrl: expected.prod.controlPlaneUrl,
          controlPlaneTokenRef: expected.prod.controlPlaneTokenRef,
        },
      },
    },
    deploymentContexts: {
      [expected.staging.context]: contextConfig(expected.staging),
      [expected.prod.context]: contextConfig(expected.prod),
    },
  };
}

export async function withProjectConfig(
  shared: Record<string, unknown>,
  run: (tmp: string) => Promise<void>,
) {
  const oldCwd = process.cwd();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "deployment-contexts-"));
  try {
    process.chdir(dir);
    await writeJson(dir, "projects/config/shared.json", {
      schemaVersion: "viberoots-project-config@1",
      ...shared,
    });
    await run(dir);
  } finally {
    process.chdir(oldCwd);
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function contextConfig(
  expected: (typeof SAMPLE_CONTEXT_EXPECTED)[keyof typeof SAMPLE_CONTEXT_EXPECTED],
) {
  return {
    controlPlane: expected.context,
    secretBackend: "infisical/default",
    infisical: {
      host: "https://app.infisical.com",
      projectId: "5a927a1a-e78d-433e-affc-17cc051780c0",
      projectName: "sample-webapp-deployments",
      projectSlug: "sample-webapp-deployments",
      environment: expected.environment,
      defaultPath: "/",
      clientIdEnv: expected.clientIdEnv,
      clientSecretEnv: expected.clientSecretEnv,
      clientIdRef: expected.clientIdRef,
      clientSecretRef: expected.clientSecretRef,
      clientIdFileName: expected.clientIdFile,
      clientSecretFileName: expected.clientSecretFile,
      machineIdentityId: expected.machineIdentityId,
      machineIdentityName: `${expected.context}-deploy`,
    },
    cloudflare: {
      account: expected.account,
      accountId: "1b911846f80a89272c0dbaf44f5c810f",
      projectName: expected.project,
      customDomain: expected.customDomain,
      zoneId: "9411ac5903acb1c2e29b3d4c04ef7e6f",
      apiTokenRef: "secret://deployments/sample-webapp/cloudflare_api_token",
    },
  };
}

function sharedTargets() {
  return [
    'load("@viberoots//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy")',
    'deployment_lane_governance(name = "lane_governance", scm_backend = "github", repository = "viberoots/viberoots", source_ref_policies = [{"stage": "staging", "allowed_refs": "main", "required_checks": "deploy/admission"}, {"stage": "prod", "allowed_refs": "refs/tags/release/*", "required_checks": "deploy/admission"}], trusted_reporter_identities = ["repository-role:admin"], required_approval_boundaries = [{"stage": "prod", "required_approvals": "repository-role:admin"}], visibility = ["PUBLIC"])',
    'deployment_lane_policy(name = "lane", defaults = "//projects/deployments:defaults", stages = ["staging", "prod"], source_ref_policy = {"staging": "main", "prod": "refs/tags/release/*"}, allowed_promotion_edges = ["staging->prod"], artifact_reuse_mode = "same_artifact", governance_policy = ":lane_governance", visibility = ["PUBLIC"])',
    'deployment_admission_policy(name = "staging_release", allowed_refs = ["main"], required_checks = ["deploy/admission"], required_approvals = [], retry_branch_policy = "branch_independent", artifact_attestation_mode = "recorded_exact_artifact", visibility = ["PUBLIC"])',
    'deployment_admission_policy(name = "prod_release", allowed_refs = ["refs/tags/release/*"], required_checks = ["deploy/admission"], required_approvals = ["repository-role:admin"], retry_branch_policy = "branch_independent", artifact_attestation_mode = "recorded_exact_artifact", visibility = ["PUBLIC"])',
  ].join("\n");
}

function familyBzl() {
  return [
    'load("@viberoots//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
    'load("@viberoots//build-tools/deployments:family_defs.bzl", "compose_deployment_family_kwargs", "deployment_family_defaults", "deployment_stage_delta")',
    '_ACCOUNT_ID = "1b911846f80a89272c0dbaf44f5c810f"',
    '_ZONE_ID = "9411ac5903acb1c2e29b3d4c04ef7e6f"',
    "def _family_defaults():",
    '    return deployment_family_defaults(component = "//projects/apps/sample-webapp:app", lane_policy = "//projects/deployments/sample-webapp/shared:lane")',
    "def _cloudflare_stage(stage, admission_policy, protection_class, domain, prerequisite):",
    '    prerequisites = [] if not prerequisite else [{"deployment_id": prerequisite, "mode": "ordering_only"}]',
    '    return deployment_stage_delta(stage = stage, deployment_context = "sample-webapp-%s" % stage, admission_policy = "//projects/deployments/sample-webapp/shared:%s" % admission_policy, protection_class = protection_class, ingress_hostnames = [domain], secret_requirements = [{"name": "cloudflare_api_token", "step": step, "contract_id": "secret://deployments/sample-webapp/cloudflare_api_token", "required": "true"} for step in ["provision", "publish", "preview_cleanup"]], external_requirement_profiles = ["cloudflare_provider"], prerequisites = prerequisites)',
    'def sample_webapp_cloudflare_deployment(name, stage, domain, admission_policy, protection_class, prerequisite, account = "", project = ""):',
    "    if account:",
    '        fail("sample_webapp_cloudflare_deployment must not set account; provider_target.account comes from deployment context sample-webapp-%s" % stage)',
    "    if project:",
    '        fail("sample_webapp_cloudflare_deployment must not set project; provider_target.project comes from deployment context sample-webapp-%s" % stage)',
    '    cloudflare_pages_static_webapp_deployment(**compose_deployment_family_kwargs(_family_defaults(), _cloudflare_stage(stage, admission_policy, protection_class, domain, prerequisite), provider_args = {"name": name, "account": "", "account_id": _ACCOUNT_ID, "custom_domain": "", "custom_domain_zone_id": _ZONE_ID, "project": ""}, include_provider_target = False))',
  ].join("\n");
}

async function writeStage(tmp: string, stage: "staging" | "prod", explicitProviderValues: boolean) {
  const expected = SAMPLE_CONTEXT_EXPECTED[stage];
  const extra = explicitProviderValues
    ? ['    account = "wrong-account",', '    project = "wrong-project",']
    : [];
  await writeFile(
    tmp,
    `projects/deployments/sample-webapp/${stage}/TARGETS`,
    [
      'load("//projects/deployments/sample-webapp/shared:family.bzl", "sample_webapp_cloudflare_deployment")',
      "sample_webapp_cloudflare_deployment(",
      '    name = "deploy",',
      `    stage = "${stage}",`,
      ...extra,
      `    domain = "${expected.customDomain}",`,
      `    admission_policy = "${stage}_release",`,
      '    protection_class = "shared_nonprod",',
      '    prerequisite = "",',
      ")",
    ].join("\n"),
  );
}

async function writeJson(tmp: string, relativePath: string, value: unknown) {
  await writeFile(tmp, relativePath, JSON.stringify(value, null, 2));
}

async function writeFile(tmp: string, relativePath: string, contents: string) {
  const target = path.join(tmp, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${contents}\n`, "utf8");
}
