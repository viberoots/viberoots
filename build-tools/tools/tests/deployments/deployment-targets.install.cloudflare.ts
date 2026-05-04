import type { CloudflarePagesDeployment } from "../../deployments/contract";
import { installAppTargetsForDeployments } from "./deployment-targets.install.app-targets";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  synchronizeInstalledDeployments,
  writeTargetsFragments,
} from "./deployment-targets.install.fragments";
import {
  renderPreviewLines,
  renderPrerequisiteList,
  renderRequirementList,
  renderSmokeLines,
  renderStringDictLines,
  renderStringList,
  renderStringRecordList,
} from "./deployment-targets.install.render";
import {
  sharedPolicyTargetsByDir,
  synchronizeGovernanceChecks,
} from "./deployment-targets.install.shared-policies";

function renderVaultRuntime(deployment: CloudflarePagesDeployment): Record<string, string> {
  const config = deployment.vaultRuntime;
  if (!config) return {};
  const callback = config.pkceCallback;
  const fields: Array<[string, unknown]> = [
    ["addr", config.addr],
    ["oidc_issuer", config.oidcIssuer],
    ["audience", config.audience],
    ["deployment_client_id", config.deploymentClientId],
    ["cli_public_client_id", config.cliPublicClientId],
    ["service_account_client_id", config.serviceAccountClientId],
    ["deployment_environment", config.deploymentEnvironment],
    ["jwt_role", config.roleName],
    ["jwt_file", config.jwtFile],
    ["client_secret_env", config.clientSecretEnv],
    ["preferred_credential_source", config.preferredCredentialSource],
    ["jenkins_client_secret_env", config.jenkinsClientSecretEnv],
    ["external_oidc_token_env", config.externalOidcTokenEnv],
    ["pkce_callback_mode", callback?.mode],
    ["pkce_callback_external_scheme", callback?.externalScheme],
    ["pkce_callback_external_host", callback?.externalHost],
    ["pkce_callback_external_port", callback?.externalPort],
    ["pkce_callback_external_path", callback?.externalPath],
    ["pkce_callback_bind_host", callback?.bindHost],
    ["pkce_callback_bind_port", callback?.bindPort],
    ["pkce_callback_bind_path", callback?.bindPath],
    ["pkce_callback_open_firewall", callback?.openFirewall],
  ];
  return Object.fromEntries(
    fields.flatMap(([key, value]) =>
      value === undefined || value === null || value === "" ? [] : [[key, String(value)]],
    ),
  );
}

export async function installCloudflarePagesTargets(
  workspaceRoot: string,
  deployments: CloudflarePagesDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
      ],
      bodyLines: [
        "cloudflare_pages_static_webapp_deployment(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    account = ${JSON.stringify(deployment.providerTarget.account)},`,
        ...(deployment.providerTarget.accountId
          ? [`    account_id = ${JSON.stringify(deployment.providerTarget.accountId)},`]
          : []),
        ...(deployment.providerTarget.customDomain
          ? [`    custom_domain = ${JSON.stringify(deployment.providerTarget.customDomain)},`]
          : []),
        ...(deployment.providerTarget.customDomainZoneId
          ? [
              `    custom_domain_zone_id = ${JSON.stringify(deployment.providerTarget.customDomainZoneId)},`,
            ]
          : []),
        `    project = ${JSON.stringify(deployment.providerTarget.project)},`,
        ...(deployment.providerTarget.id !== deployment.providerTarget.project
          ? [`    project_id = ${JSON.stringify(deployment.providerTarget.id)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        ...(deployment.vaultRuntime
          ? ["    vault_runtime =", ...renderStringDictLines(renderVaultRuntime(deployment))]
          : []),
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...(deployment.externalRequirementProfiles &&
        deployment.externalRequirementProfiles.length > 0
          ? [
              `    external_requirement_profiles = ${renderStringList(
                deployment.externalRequirementProfiles,
              )},`,
            ]
          : []),
        ...(deployment.releaseActions.length > 0
          ? [
              `    release_actions = ${renderStringList(deployment.releaseActions.map((action) => action.ref))},`,
            ]
          : []),
        ...(deployment.targetExceptions.length > 0
          ? [
              `    target_exceptions = ${renderStringList(
                deployment.targetExceptions.map((exception) => exception.ref),
              )},`,
            ]
          : []),
        ...renderSmokeLines(deployment.smoke),
        ...renderPreviewLines(deployment),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}
