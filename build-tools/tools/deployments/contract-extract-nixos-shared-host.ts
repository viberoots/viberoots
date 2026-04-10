#!/usr/bin/env zx-wrapper
import {
  deploymentIdFromLabel,
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type NixosSharedHostDeployment,
} from "./contract-types.ts";
import {
  pushDuplicateNixosSharedHostAppNameErrors,
  readRawNixosSharedHostComponents,
  rolloutPolicyErrorsForNixosSharedHost,
} from "./contract-extract-components.ts";
import {
  deploymentError,
  readLabel,
  readLabelList,
  readPrerequisites,
  readPreviewPolicy,
  readRolloutPolicy,
  readSmokePolicy,
  readString,
  type DeploymentExtractionContext,
} from "./contract-extract-shared.ts";
import { readBootstrapPolicy } from "./deployment-bootstrap-policy.ts";
import {
  resolveDeploymentMetadataRefs,
  validateExplicitDeploymentRequirements,
} from "./deployment-extract-metadata.ts";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding.ts";
import { readDeploymentRequirements } from "./deployment-requirements.ts";
import {
  nixosSharedHostPromotionCompatibilityErrors,
  pushNixosSharedHostReleaseActionErrors,
  resolveNixosSharedHostComponents,
} from "./nixos-shared-host-extract-helpers.ts";
import type { DeploymentBootstrapPolicy } from "./contract-types.ts";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy.ts";

const SHARED_NONPROD = "shared_nonprod";

function validateBootstrapPolicy(
  label: string,
  bootstrap: DeploymentBootstrapPolicy | undefined,
  errors: string[],
) {
  if (!bootstrap) return;
  if (bootstrap.scope !== "deployment_authority") {
    errors.push(
      deploymentError(label, `unsupported bootstrap.scope "${bootstrap.scope || "<empty>"}"`),
    );
  }
  if (bootstrap.modes.length === 0) {
    errors.push(
      deploymentError(
        label,
        "bootstrap policy must enable allow_first_install or allow_offline_recovery",
      ),
    );
  }
}

export function extractNixosSharedHostDeploymentsFromContext(
  context: DeploymentExtractionContext,
): NixosSharedHostDeployment[] {
  const deployments: NixosSharedHostDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== NIXOS_SHARED_HOST_PROVIDER) continue;
    const label = readLabel(node, "name");
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const prerequisites = readPrerequisites(node, "prerequisites");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const preview = readPreviewPolicy(node, "preview");
    const smoke = readSmokePolicy(node);
    const bootstrap = readBootstrapPolicy(node, "bootstrap");
    const publisher = readString(node, "publisher");
    const provisioner = readString(node, "provisioner");
    const rolloutPolicy = readRolloutPolicy(node);
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const runtimeConfigRequirements = readDeploymentRequirements(
      node,
      "runtime_config_requirements",
    );
    const releaseActionRefs = readLabelList(node, "release_actions");
    const targetExceptionRefs = readLabelList(node, "target_exceptions");
    const deploymentErrors: string[] = [];
    const rawComponents = readRawNixosSharedHostComponents(node);
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    if (!publisher) deploymentErrors.push(deploymentError(label, "missing required publisher"));
    if (!provisioner) deploymentErrors.push(deploymentError(label, "missing required provisioner"));
    if (preview) {
      deploymentErrors.push(
        deploymentError(label, "preview is not supported for nixos-shared-host"),
      );
    }
    validateBootstrapPolicy(label, bootstrap, deploymentErrors);
    if (protectionClass !== SHARED_NONPROD) {
      deploymentErrors.push(
        deploymentError(
          label,
          `nixos-shared-host deployments must use protection_class "${SHARED_NONPROD}"`,
        ),
      );
    }
    validateExplicitDeploymentRequirements({
      node,
      label,
      fieldPath: "secret_requirements",
      requirements: secretRequirements,
      errors: deploymentErrors,
    });
    validateExplicitDeploymentRequirements({
      node,
      label,
      fieldPath: "runtime_config_requirements",
      requirements: runtimeConfigRequirements,
      errors: deploymentErrors,
    });
    pushSmokePolicyErrors({ label, protectionClass, smoke, errors: deploymentErrors });
    const resolvedComponents = resolveNixosSharedHostComponents({
      context,
      label,
      rawComponents,
      errors: deploymentErrors,
    });
    const releaseActions = resolveDeploymentMetadataRefs({
      refs: releaseActionRefs,
      label,
      kind: "release_action",
      values: context.releaseActions,
      errors: deploymentErrors,
    });
    pushNixosSharedHostReleaseActionErrors({
      label,
      releaseActions,
      secretRequirements,
      runtimeConfigRequirements,
      errors: deploymentErrors,
    });
    const targetExceptions = resolveDeploymentMetadataRefs({
      refs: targetExceptionRefs,
      label,
      kind: "target_exception",
      values: context.targetExceptions,
      errors: deploymentErrors,
    });
    const { lanePolicy, admissionPolicy } = resolveSharedDeploymentPolicies({
      context,
      label,
      lanePolicyRef,
      admissionPolicyRef,
      environmentStage,
      errors: deploymentErrors,
    });
    const targetGroups = new Set(
      resolvedComponents.map((component) => component.providerTarget.targetGroup),
    );
    if (targetGroups.size > 1) {
      deploymentErrors.push(
        deploymentError(
          label,
          "multi-component nixos-shared-host deployments must resolve to one target_group",
        ),
      );
    }
    deploymentErrors.push(
      ...rolloutPolicyErrorsForNixosSharedHost(
        label,
        protectionClass,
        rawComponents,
        rolloutPolicy,
      ),
    );
    deploymentErrors.push(
      ...nixosSharedHostPromotionCompatibilityErrors({
        label,
        components: resolvedComponents,
      }),
    );
    if (deploymentErrors.length > 0) {
      context.errors.push(...deploymentErrors);
      continue;
    }
    deployments.push({
      deploymentId: deploymentIdFromLabel(label),
      label,
      name: targetName(label),
      provider: NIXOS_SHARED_HOST_PROVIDER,
      protectionClass,
      lanePolicyRef,
      lanePolicy: lanePolicy!,
      environmentStage,
      admissionPolicyRef,
      admissionPolicy: admissionPolicy!,
      prerequisites,
      secretRequirements,
      runtimeConfigRequirements,
      releaseActions,
      targetExceptions,
      ...(smoke ? { smoke } : {}),
      ...(rolloutPolicy ? { rolloutPolicy } : {}),
      ...(bootstrap ? { bootstrap } : {}),
      component: { kind: resolvedComponents[0]!.kind, target: resolvedComponents[0]!.target },
      components: resolvedComponents,
      publisher: { type: publisher },
      ...(provisioner ? { provisioner: { type: provisioner } } : {}),
      runtime: resolvedComponents[0]!.runtime,
      providerTarget: deriveNixosSharedHostProviderTarget({
        appNames: resolvedComponents.map((component) => component.runtime.appName),
        targetGroup: resolvedComponents[0]!.providerTarget.targetGroup,
      }),
    });
  }
  pushDuplicateNixosSharedHostAppNameErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
