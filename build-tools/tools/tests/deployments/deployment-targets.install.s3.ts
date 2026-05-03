import type { S3StaticDeployment } from "../../deployments/contract.ts";
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

export async function installS3StaticTargets(
  workspaceRoot: string,
  deployments: S3StaticDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: ['load("//build-tools/deployments:defs.bzl", "s3_static_webapp_deployment")'],
      bodyLines: [
        "s3_static_webapp_deployment(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    account = ${JSON.stringify(deployment.providerTarget.account)},`,
        `    bucket = ${JSON.stringify(deployment.providerTarget.bucket)},`,
        `    region = ${JSON.stringify(deployment.providerTarget.region)},`,
        ...(deployment.providerTarget.distribution
          ? [`    distribution = ${JSON.stringify(deployment.providerTarget.distribution)},`]
          : []),
        `    publisher_config = ${JSON.stringify(deployment.publisher.config)},`,
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
        ...renderSmokeLines(deployment.smoke),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}
