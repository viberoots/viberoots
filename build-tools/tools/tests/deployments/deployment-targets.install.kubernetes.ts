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
  renderStringList,
  renderStringRecordList,
} from "./deployment-targets.install.render.ts";
import {
  sharedPolicyTargetsByDir,
  synchronizeGovernanceChecks,
} from "./deployment-targets.install.shared-policies.ts";

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
        "    },",
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...renderSmokeLines(deployment.smoke),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}
