#!/usr/bin/env zx-wrapper
import {
  APP_STORE_CONNECT_PROVIDER,
  deploymentIdFromLabel,
  MOBILE_APP_COMPONENT_KIND,
  targetName,
  type AppStoreConnectDeployment,
} from "./contract-types";
import { deriveAppStoreConnectProviderTarget } from "./deployment-provider-targets";
import { readPrimaryDeploymentComponent } from "./contract-extract-components";
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
} from "./contract-extract-shared";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata";
import { deploymentSecretMetadata as secretMeta } from "./deployment-secret-metadata";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding";
import {
  resolveDeploymentMetadataRefs,
  validateExplicitDeploymentRequirements,
} from "./deployment-extract-metadata";
import { readDeploymentRequirements } from "./deployment-requirements";
import { pushAppStoreConnectComponentKindErrors } from "./app-store-connect-capability-validation";
import { pushAppStoreConnectRolloutErrors } from "./app-store-connect-rollout-validation";
import {
  APP_STORE_CONNECT_VALID_SIGNING_MODELS,
  APP_STORE_CONNECT_VALID_TRACKS,
  MOBILE_STORE_TARGET_TOKEN_RE,
  pushDuplicateProviderTargetIdentityErrors,
  pushMobileStoreProtectionClassError,
} from "./mobile-store-extract-helpers";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy";
export function extractAppStoreConnectDeploymentsFromContext(
  context: DeploymentExtractionContext,
): AppStoreConnectDeployment[] {
  const deployments: AppStoreConnectDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== APP_STORE_CONNECT_PROVIDER) continue;
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
    const protectionClass = readString(node, "protection_class") || "shared_nonprod";
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
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
    const deploymentErrors: string[] = [];
    const issuer = providerTarget.issuer || "";
    const app = providerTarget.app || "";
    const bundleId = providerTarget.bundle_id || "";
    const platform = providerTarget.platform || "ios";
    const track = providerTarget.track || "";
    const signingModel = providerTarget.signing_model || "";
    const secretMetadata = secretMeta(node, label, secretRequirements, deploymentErrors);
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (components.length > 1) {
      deploymentErrors.push(
        deploymentError(label, "app-store-connect does not support multi-component deployments"),
      );
    }
    pushMobileStoreProtectionClassError({
      label,
      provider: "app-store-connect",
      protectionClass,
      errors: deploymentErrors,
    });
    for (const [fieldPath, value] of [
      ["provider_target.issuer", issuer],
      ["provider_target.app", app],
      ["provider_target.bundle_id", bundleId],
    ] as const) {
      pushTokenFieldErrors({
        errors: deploymentErrors,
        label,
        fieldPath,
        value,
        pattern: MOBILE_STORE_TARGET_TOKEN_RE,
        invalidMessage: `${fieldPath} must use reviewed token characters only`,
      });
    }
    if (platform !== "ios") {
      deploymentErrors.push(
        deploymentError(
          label,
          `app-store-connect only supports provider_target.platform "ios", got "${platform || "<empty>"}"`,
        ),
      );
    }
    if (!APP_STORE_CONNECT_VALID_TRACKS.has(track)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `app-store-connect track must be one of ${Array.from(APP_STORE_CONNECT_VALID_TRACKS).join(", ")}`,
        ),
      );
    }
    if (!APP_STORE_CONNECT_VALID_SIGNING_MODELS.has(signingModel)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `app-store-connect signing_model must be one of ${Array.from(APP_STORE_CONNECT_VALID_SIGNING_MODELS).join(", ")}`,
        ),
      );
    }
    if (publisher !== "app-store-connect-mobile-release") {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported app-store-connect publisher "${publisher || "<empty>"}"`,
        ),
      );
    }
    if (!publisherConfig)
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(
          label,
          "app-store-connect does not support protected/shared release_actions",
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
    pushAppStoreConnectComponentKindErrors({
      label,
      declaredKind: primaryComponent?.kind || componentKind,
      componentTarget: primaryComponent?.target || componentTarget,
      componentNode: context.components.get(primaryComponent?.target || componentTarget),
      errors: deploymentErrors,
    });
    pushAppStoreConnectRolloutErrors({ label, rolloutPolicy, errors: deploymentErrors });
    pushSmokePolicyErrors({
      label,
      protectionClass,
      componentKind: "mobile-app",
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
      provider: APP_STORE_CONNECT_PROVIDER,
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
      ...(smoke ? { smoke } : {}),
      ...(rolloutPolicy ? { rolloutPolicy } : {}),
      ...(vaultRuntime ? { vaultRuntime } : {}),
      component: { kind: MOBILE_APP_COMPONENT_KIND, target: componentTarget },
      components: [
        {
          id: primaryComponent?.id || "default",
          kind: MOBILE_APP_COMPONENT_KIND,
          target: primaryComponent?.target || componentTarget,
        },
      ],
      publisher: { type: publisher, config: publisherConfig },
      providerTarget: deriveAppStoreConnectProviderTarget({
        issuer,
        app,
        bundleId,
        platform,
        track,
        signingModel,
      }),
    });
  }
  pushDuplicateProviderTargetIdentityErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
