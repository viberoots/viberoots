import type { CloudflarePagesDeployment } from "../../deployments/contract.ts";
import { installAppTargetsForDeployments } from "./deployment-targets.install.app-targets.ts";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  synchronizeInstalledDeployments,
  writeTargetsFragments,
} from "./deployment-targets.install.fragments.ts";
import {
  renderPreviewLines,
  renderPrerequisiteList,
  renderRequirementList,
  renderSmokeLines,
  renderStringList,
  renderStringRecordList,
} from "./deployment-targets.install.render.ts";
import {
  sharedPolicyTargetsByDir,
  synchronizeGovernanceChecks,
} from "./deployment-targets.install.shared-policies.ts";

function renderVaultRuntime(deployment: CloudflarePagesDeployment): Record<string, string>[] {
  const config = deployment.vaultRuntime;
  if (!config) return [];
  return [
    {
      ...(config.addr ? { addr: config.addr } : {}),
      ...(config.oidcIssuer ? { oidc_issuer: config.oidcIssuer } : {}),
      ...(config.audience ? { audience: config.audience } : {}),
      ...(config.deploymentClientId ? { deployment_client_id: config.deploymentClientId } : {}),
      ...(config.deploymentEnvironment
        ? { deployment_environment: config.deploymentEnvironment }
        : {}),
      ...(config.roleName ? { jwt_role: config.roleName } : {}),
      ...(config.jwtFile ? { jwt_file: config.jwtFile } : {}),
      ...(config.clientSecretEnv ? { client_secret_env: config.clientSecretEnv } : {}),
    },
  ];
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
        `    project = ${JSON.stringify(deployment.providerTarget.project)},`,
        ...(deployment.providerTarget.id !== deployment.providerTarget.project
          ? [`    project_id = ${JSON.stringify(deployment.providerTarget.id)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        ...(deployment.vaultRuntime
          ? ["    vault_runtime =", ...renderStringRecordList(renderVaultRuntime(deployment))]
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
