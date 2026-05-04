import type { KubernetesDeployment } from "../../deployments/contract.ts";
import { installAppTargetsForDeployments } from "./deployment-targets.install.app-targets.ts";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  synchronizeInstalledDeployments,
  writeTargetsFragments,
} from "./deployment-targets.install.fragments.ts";
import {
  renderPrerequisiteList,
  renderRequirementList,
  renderSmokeLines,
  renderStringDictLines,
  renderStringList,
  renderStringRecordList,
} from "./deployment-targets.install.render.ts";
import {
  sharedPolicyTargetsByDir,
  synchronizeGovernanceChecks,
} from "./deployment-targets.install.shared-policies.ts";

function renderVaultRuntime(deployment: KubernetesDeployment): Record<string, string> {
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

export async function installKubernetesTargets(
  workspaceRoot: string,
  deployments: KubernetesDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: ['load("//build-tools/deployments:defs.bzl", "deployment_target")'],
      bodyLines: [
        "deployment_target(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        '    provider = "kubernetes",',
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    component_kind = ${JSON.stringify(deployment.component.kind)},`,
        `    publisher = ${JSON.stringify(deployment.publisher.type)},`,
        `    publisher_config = ${JSON.stringify(deployment.publisher.config)},`,
        ...(deployment.provisioner
          ? [
              `    provisioner = ${JSON.stringify(deployment.provisioner.type)},`,
              `    provisioner_config = ${JSON.stringify(deployment.provisioner.config || "")},`,
            ]
          : []),
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        "    components = [",
        ...deployment.components.flatMap((component) => [
          "        {",
          `            "id": ${JSON.stringify(component.id)},`,
          `            "kind": ${JSON.stringify(component.kind)},`,
          `            "target": ${JSON.stringify(component.target)},`,
          "        },",
        ]),
        "    ],",
        ...(deployment.rolloutPolicy
          ? [
              "    rollout_policy = {",
              `        "mode": ${JSON.stringify(deployment.rolloutPolicy.mode)},`,
              `        "abort": ${JSON.stringify(deployment.rolloutPolicy.abort)},`,
              `        "smoke": ${JSON.stringify(deployment.rolloutPolicy.smoke)},`,
              "    },",
              `    rollout_steps = ${renderStringList(deployment.rolloutPolicy.steps)},`,
            ]
          : []),
        "    provider_target = {",
        `        "cluster": ${JSON.stringify(deployment.providerTarget.cluster)},`,
        `        "namespace": ${JSON.stringify(deployment.providerTarget.namespace)},`,
        `        "release": ${JSON.stringify(deployment.providerTarget.release)},`,
        `        "id": ${JSON.stringify(deployment.providerTarget.id)},`,
        ...(deployment.providerTarget.serviceKind
          ? [`        "service_kind": ${JSON.stringify(deployment.providerTarget.serviceKind)},`]
          : []),
        ...(deployment.providerTarget.ingressMode
          ? [`        "ingress_mode": ${JSON.stringify(deployment.providerTarget.ingressMode)},`]
          : []),
        ...(deployment.providerTarget.healthPath
          ? [`        "health_path": ${JSON.stringify(deployment.providerTarget.healthPath)},`]
          : []),
        ...(deployment.provisioner?.type === "opentofu-stack"
          ? [
              `        "stack_identity": ${JSON.stringify(deployment.provisioner.stackIdentity)},`,
              `        "state_backend_identity": ${JSON.stringify(deployment.provisioner.stateBackendIdentity)},`,
              `        "allowed_environment_differences": ${JSON.stringify(deployment.provisioner.allowedEnvironmentDifferences.join(","))},`,
            ]
          : []),
        "    },",
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
        ...renderSmokeLines(deployment.smoke),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}
