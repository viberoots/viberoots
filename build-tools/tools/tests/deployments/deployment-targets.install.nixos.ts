import type { NixosSharedHostDeployment } from "../../deployments/contract";
import { installAppTargetsForDeployments } from "./deployment-targets.install.app-targets";
import {
  appendTargetsFragment,
  labelDir,
  labelName,
  synchronizeInstalledDeployments,
  writeTargetsFragments,
} from "./deployment-targets.install.fragments";
import {
  renderBootstrapLines,
  renderPrerequisiteList,
  renderRequirementList,
  renderSmokeLines,
  renderStringList,
  renderStringRecordList,
} from "./deployment-targets.install.render";
import {
  sharedPolicyTargetsByDir,
  synchronizeGovernanceChecks,
} from "./deployment-targets.install.shared-policies";

export async function installNixosSharedHostTargets(
  workspaceRoot: string,
  deployments: NixosSharedHostDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    const isMultiComponent = deployment.components.length > 1;
    const singleComponent = deployment.components[0];
    const isSsr = !!singleComponent && singleComponent.kind === "ssr-webapp";
    const loadRule = isMultiComponent
      ? "nixos_shared_host_multi_static_webapp_deployment"
      : isSsr
        ? "nixos_shared_host_ssr_webapp_deployment"
        : "nixos_shared_host_static_webapp_deployment";
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: [
        `load("@viberoots//build-tools/deployments:defs.bzl", ${JSON.stringify(loadRule)})`,
      ],
      bodyLines: [
        `${loadRule}(`,
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        ...(isMultiComponent
          ? [
              "    components = [",
              ...deployment.components.flatMap((component) => [
                "        {",
                `            "id": ${JSON.stringify(component.id)},`,
                `            "target": ${JSON.stringify(component.target)},`,
                `            "app_name": ${JSON.stringify(component.runtime.appName)},`,
                `            "container_port": ${JSON.stringify(
                  String(component.runtime.containerPort),
                )},`,
                `            "health_path": ${JSON.stringify(component.runtime.healthPath || "")},`,
                `            "target_group": ${JSON.stringify(
                  component.runtime.targetGroup || "",
                )},`,
                "        },",
              ]),
              "    ],",
              ...(deployment.rolloutPolicy
                ? [
                    "    rollout_policy = {",
                    `        "mode": ${JSON.stringify(deployment.rolloutPolicy.mode)},`,
                    `        "abort": ${JSON.stringify(deployment.rolloutPolicy.abort)},`,
                    `        "smoke": ${JSON.stringify(deployment.rolloutPolicy.smoke)},`,
                    `        "steps": ${renderStringList(deployment.rolloutPolicy.steps)},`,
                    "    },",
                    `    target_group = ${JSON.stringify(
                      deployment.providerTarget.targetGroup || "",
                    )},`,
                  ]
                : []),
            ]
          : [
              `    component = ${JSON.stringify(singleComponent?.target || deployment.component.target)},`,
              `    app_name = ${JSON.stringify(singleComponent?.runtime.appName || deployment.runtime.appName)},`,
              `    container_port = ${
                singleComponent?.runtime.containerPort || deployment.runtime.containerPort
              },`,
              `    health_path = ${JSON.stringify(
                singleComponent?.runtime.healthPath || deployment.runtime.healthPath || "",
              )},`,
              `    target_group = ${JSON.stringify(
                singleComponent?.runtime.targetGroup || deployment.runtime.targetGroup || "",
              )},`,
              ...(isSsr &&
              singleComponent &&
              "runtimeContract" in singleComponent.runtime &&
              singleComponent.runtime.runtimeContract
                ? [
                    `    framework = ${JSON.stringify(
                      singleComponent.runtime.runtimeContract.framework,
                    )},`,
                  ]
                : []),
            ]),
        `    publisher = ${JSON.stringify(deployment.publisher.type)},`,
        ...(deployment.provisioner
          ? [`    provisioner = ${JSON.stringify(deployment.provisioner.type)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
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
        ...renderBootstrapLines(deployment),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}
