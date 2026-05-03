#!/usr/bin/env zx-wrapper
import {
  deploymentIdFromLabel,
  KUBERNETES_PROVIDER,
  targetName,
  type KubernetesDeployment,
} from "./contract-types.ts";
import { deriveKubernetesProviderTarget } from "./deployment-provider-targets.ts";
import { readPrimaryDeploymentComponent } from "./contract-extract-components.ts";
import {
  deploymentError,
  pushTokenFieldErrors,
  readLabel,
  readLabelList,
  readPrerequisites,
  readRolloutPolicy,
  readSmokePolicy,
  readString,
  readStringRecord,
  type DeploymentExtractionContext,
} from "./contract-extract-shared.ts";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata.ts";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding.ts";
import { resolveDeploymentMetadataRefs } from "./deployment-extract-metadata.ts";
import { pushKubernetesComponentKindErrors } from "./kubernetes-capability-validation.ts";
import { pushKubernetesRolloutErrors } from "./kubernetes-rollout-validation.ts";
import { pushKubernetesServicePostureErrors } from "./kubernetes-service-posture.ts";
import { readDeploymentRequirements } from "./deployment-requirements.ts";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy.ts";
import {
  readOpenTofuProvisionerMetadata,
  REVIEWED_STACK_PROVISIONERS,
} from "./opentofu-stack-extract.ts";
import { pushDuplicateProviderTargetIdentityErrors } from "./provider-target-identity-errors.ts";
const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const VALID_PROTECTION_CLASSES = new Set(["local_only", "shared_nonprod", "production_facing"]);

export function extractKubernetesDeploymentsFromContext(
  context: DeploymentExtractionContext,
): KubernetesDeployment[] {
  const deployments: KubernetesDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== KUBERNETES_PROVIDER) continue;
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
    const smoke = readSmokePolicy(node);
    const vaultRuntime = readVaultRuntimeConfig(node);
    const rolloutPolicy = readRolloutPolicy(node);
    const cluster = providerTarget.cluster || "";
    const namespace = providerTarget.namespace || "";
    const release = providerTarget.release || "";
    const id = providerTarget.id || `${cluster}/${namespace}/${release}`;
    const expectedId = `${cluster}/${namespace}/${release}`;
    const deploymentErrors: string[] = [];
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (!VALID_PROTECTION_CLASSES.has(protectionClass)) {
      deploymentErrors.push(
        deploymentError(
          label,
          'kubernetes deployments must use protection_class "local_only", "shared_nonprod", or "production_facing"',
        ),
      );
    }
    for (const [fieldPath, value] of [
      ["provider_target.cluster", cluster],
      ["provider_target.namespace", namespace],
      ["provider_target.release", release],
    ] as const) {
      pushTokenFieldErrors({
        errors: deploymentErrors,
        label,
        fieldPath,
        value,
        pattern: TARGET_TOKEN_RE,
        invalidMessage: `${fieldPath} must be lowercase alphanumeric plus internal hyphens`,
      });
    }
    if (!id) {
      deploymentErrors.push(deploymentError(label, "provider_target.id is required"));
    }
    if (id && id !== expectedId) {
      deploymentErrors.push(
        deploymentError(
          label,
          `provider_target.id ${id} does not match canonical target ${expectedId}`,
        ),
      );
    }
    if (publisher !== "helm-release") {
      deploymentErrors.push(
        deploymentError(label, `unsupported kubernetes publisher "${publisher || "<empty>"}"`),
      );
    }
    if (!publisherConfig) {
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    }
    const openTofuProvisioner = readOpenTofuProvisionerMetadata({
      label,
      provisioner,
      provisionerConfig,
      providerTarget,
      errors: deploymentErrors,
    });
    if (provisioner && !REVIEWED_STACK_PROVISIONERS.has(provisioner)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported kubernetes provisioner "${provisioner}" (expected terraform-stack, cdktf-stack, or opentofu-stack)`,
        ),
      );
    }
    if (provisioner && !provisionerConfig) {
      deploymentErrors.push(
        deploymentError(label, "provisioner_config is required when provisioner is set"),
      );
    }
    if (!provisioner && provisionerConfig) {
      deploymentErrors.push(
        deploymentError(label, "provisioner_config requires a reviewed provisioner"),
      );
    }
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(label, "kubernetes does not support protected/shared release_actions"),
      );
    }
    for (const component of components) {
      pushKubernetesComponentKindErrors({
        label,
        declaredKind: component.kind || componentKind,
        componentTarget: component.target || componentTarget,
        componentNode: context.components.get(component.target || componentTarget),
        errors: deploymentErrors,
      });
    }
    pushKubernetesServicePostureErrors({
      label,
      componentKind: primaryComponent?.kind || componentKind,
      providerTarget,
      errors: deploymentErrors,
    });
    pushKubernetesRolloutErrors({
      label,
      protectionClass,
      componentIds: components.map((component) => component.id),
      rolloutPolicy,
      errors: deploymentErrors,
    });
    pushSmokePolicyErrors({
      label,
      protectionClass,
      componentKind: primaryComponent?.kind || componentKind,
      smoke,
      errors: deploymentErrors,
    });
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
      provider: KUBERNETES_PROVIDER,
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
      ...(vaultRuntime ? { vaultRuntime } : {}),
      component: { kind: primaryComponent?.kind || componentKind, target: componentTarget },
      components,
      publisher: { type: publisher, config: publisherConfig },
      ...(provisioner
        ? { provisioner: openTofuProvisioner || { type: provisioner, config: provisionerConfig } }
        : {}),
      providerTarget: deriveKubernetesProviderTarget({
        cluster,
        namespace,
        release,
        id,
        serviceKind: providerTarget.service_kind,
        ingressMode: providerTarget.ingress_mode,
        healthPath: providerTarget.health_path,
      }),
    });
  }
  pushDuplicateProviderTargetIdentityErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
