#!/usr/bin/env zx-wrapper
import {
  deploymentIdFromLabel,
  OPENTOFU_PROVIDER,
  targetName,
  type OpenTofuDeployment,
} from "./contract-types";
import { readPrimaryDeploymentComponent } from "./contract-extract-components";
import {
  deploymentError,
  readLabel,
  readLabelList,
  readPrerequisites,
  readString,
  readStringRecord,
  type DeploymentExtractionContext,
} from "./contract-extract-shared";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata";
import { deploymentSecretMetadata as secretMeta } from "./deployment-secret-metadata";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding";
import { resolveDeploymentMetadataRefs } from "./deployment-extract-metadata";
import { readDeploymentRequirements } from "./deployment-requirements";
import {
  PROVISION_ONLY_COMPONENT_KIND,
  isSupportedComponentNode,
} from "./deployment-component-kinds";
import { readOpenTofuProvisionerMetadata } from "./opentofu-stack-extract";
import { deriveOpenTofuProviderTarget } from "./opentofu-provider-target";
import { pushDuplicateProviderTargetIdentityErrors } from "./provider-target-identity-errors";

const VALID_PROTECTION_CLASSES = new Set(["local_only", "shared_nonprod", "production_facing"]);

export function extractOpenTofuDeploymentsFromContext(
  context: DeploymentExtractionContext,
): OpenTofuDeployment[] {
  const deployments: OpenTofuDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== OPENTOFU_PROVIDER) continue;
    const label = readLabel(node, "name");
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    const { componentTarget, componentKind, components, primaryComponent } =
      readPrimaryDeploymentComponent(node);
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const protectionClass = readString(node, "protection_class") || "local_only";
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
    const provisioner = readString(node, "provisioner");
    const provisionerConfig = readString(node, "provisioner_config");
    const providerTarget = readStringRecord(node, "provider_target");
    const prerequisites = readPrerequisites(node, "prerequisites");
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const runtimeConfigRequirements = readDeploymentRequirements(
      node,
      "runtime_config_requirements",
    );
    const releaseActionRefs = readLabelList(node, "release_actions");
    const targetExceptionRefs = readLabelList(node, "target_exceptions");
    const migrationBundleRef = readLabel(node, "migration_bundle");
    const vaultRuntime = readVaultRuntimeConfig(node);
    const stackIdentity = providerTarget.stack_identity || "";
    const stateBackendIdentity = providerTarget.state_backend_identity || "";
    const deploymentErrors: string[] = [];
    const secretMetadata = secretMeta(node, label, secretRequirements, deploymentErrors);

    if (!VALID_PROTECTION_CLASSES.has(protectionClass)) {
      deploymentErrors.push(
        deploymentError(
          label,
          'opentofu deployments must use protection_class "local_only", "shared_nonprod", or "production_facing"',
        ),
      );
    }
    if ((primaryComponent?.kind || componentKind) !== PROVISION_ONLY_COMPONENT_KIND) {
      deploymentErrors.push(
        deploymentError(label, 'opentofu deployments must use component_kind "provision-only"'),
      );
    }
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (publisher !== "provision-only") {
      deploymentErrors.push(
        deploymentError(label, `unsupported opentofu publisher "${publisher || "<empty>"}"`),
      );
    }
    if (publisherConfig) {
      deploymentErrors.push(
        deploymentError(label, "opentofu provision-only publisher_config must be empty"),
      );
    }
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(
          label,
          "opentofu provision-only deployments do not support release_actions",
        ),
      );
    }
    const openTofuProvisioner = readOpenTofuProvisionerMetadata({
      label,
      provisioner,
      provisionerConfig,
      providerTarget,
      errors: deploymentErrors,
    });
    if (!openTofuProvisioner) {
      deploymentErrors.push(
        deploymentError(label, 'opentofu deployments must use provisioner "opentofu-stack"'),
      );
    }
    for (const component of components) {
      const declaredKind = component.kind || componentKind;
      const componentTargetForCheck = component.target || componentTarget;
      const componentNode = context.components.get(componentTargetForCheck);
      if (declaredKind !== PROVISION_ONLY_COMPONENT_KIND) {
        deploymentErrors.push(
          deploymentError(label, `opentofu component ${component.id} must be provision-only`),
        );
      } else if (!isSupportedComponentNode(PROVISION_ONLY_COMPONENT_KIND, componentNode)) {
        deploymentErrors.push(
          deploymentError(
            label,
            `component target ${componentTargetForCheck} is not a supported provision-only component`,
          ),
        );
      }
    }
    const releaseActions = resolveDeploymentMetadataRefs({
      refs: releaseActionRefs,
      label,
      kind: "release_action",
      values: context.releaseActions,
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
    if (deploymentErrors.length > 0) {
      context.errors.push(...deploymentErrors);
      continue;
    }
    deployments.push({
      deploymentId: deploymentIdFromLabel(label),
      label,
      name: targetName(label),
      provider: OPENTOFU_PROVIDER,
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
      ...secretMetadata,
      ...(migrationBundleRef ? { migrationBundleRef } : {}),
      ...(vaultRuntime ? { vaultRuntime } : {}),
      component: { kind: primaryComponent?.kind || componentKind, target: componentTarget },
      components,
      publisher: { type: "provision-only" },
      provisioner: openTofuProvisioner!,
      providerTarget: deriveOpenTofuProviderTarget({
        stackIdentity,
        stateBackendIdentity,
        allowedEnvironmentDifferences: openTofuProvisioner!.allowedEnvironmentDifferences,
      }),
    });
  }
  pushDuplicateProviderTargetIdentityErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
