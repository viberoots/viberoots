#!/usr/bin/env zx-wrapper
import {
  GOOGLE_PLAY_PROVIDER,
  MOBILE_APP_COMPONENT_KIND,
  deploymentIdFromLabel,
  targetName,
  type GooglePlayDeployment,
} from "./contract-types.ts";
import { deriveGooglePlayProviderTarget } from "./deployment-provider-targets.ts";
import { readPrimaryDeploymentComponent } from "./contract-extract-components.ts";
import {
  deploymentError,
  duplicateValueEntries,
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
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding.ts";
import {
  resolveDeploymentMetadataRefs,
  validateExplicitDeploymentRequirements,
} from "./deployment-extract-metadata.ts";
import { readDeploymentRequirements } from "./deployment-requirements.ts";
import { pushGooglePlayComponentKindErrors } from "./google-play-capability-validation.ts";
import { pushGooglePlayRolloutErrors } from "./google-play-rollout-validation.ts";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy.ts";

const TOKEN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const VALID_TRACKS = new Set(["internal", "alpha", "beta", "production"]);
const VALID_SIGNING_MODELS = new Set(["play-app-signing"]);
const VALID_PROTECTION_CLASSES = new Set(["shared_nonprod", "production_facing"]);

export function extractGooglePlayDeploymentsFromContext(
  context: DeploymentExtractionContext,
): GooglePlayDeployment[] {
  const deployments: GooglePlayDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== GOOGLE_PLAY_PROVIDER) continue;
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
    const rolloutPolicy = readRolloutPolicy(node);
    const deploymentErrors: string[] = [];
    const developerAccount = providerTarget.developer_account || "";
    const app = providerTarget.app || "";
    const packageName = providerTarget.package_name || "";
    const platform = providerTarget.platform || "android";
    const track = providerTarget.track || "";
    const signingModel = providerTarget.signing_model || "";
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (components.length > 1) {
      deploymentErrors.push(
        deploymentError(label, "google-play does not support multi-component deployments"),
      );
    }
    if (!VALID_PROTECTION_CLASSES.has(protectionClass)) {
      deploymentErrors.push(
        deploymentError(
          label,
          'google-play deployments must use protection_class "shared_nonprod" or "production_facing"',
        ),
      );
    }
    for (const [fieldPath, value] of [
      ["provider_target.developer_account", developerAccount],
      ["provider_target.app", app],
      ["provider_target.package_name", packageName],
    ] as const) {
      pushTokenFieldErrors({
        errors: deploymentErrors,
        label,
        fieldPath,
        value,
        pattern: TOKEN_RE,
        invalidMessage: `${fieldPath} must use reviewed token characters only`,
      });
    }
    if (platform !== "android") {
      deploymentErrors.push(
        deploymentError(
          label,
          `google-play only supports provider_target.platform "android", got "${platform || "<empty>"}"`,
        ),
      );
    }
    if (!VALID_TRACKS.has(track)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `google-play track must be one of ${Array.from(VALID_TRACKS).join(", ")}`,
        ),
      );
    }
    if (!VALID_SIGNING_MODELS.has(signingModel)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `google-play signing_model must be one of ${Array.from(VALID_SIGNING_MODELS).join(", ")}`,
        ),
      );
    }
    if (publisher !== "google-play-mobile-release") {
      deploymentErrors.push(
        deploymentError(label, `unsupported google-play publisher "${publisher || "<empty>"}"`),
      );
    }
    if (!publisherConfig) {
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    }
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(label, "google-play does not support protected/shared release_actions"),
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
    pushGooglePlayComponentKindErrors({
      label,
      declaredKind: primaryComponent?.kind || componentKind,
      componentTarget: primaryComponent?.target || componentTarget,
      componentNode: context.components.get(primaryComponent?.target || componentTarget),
      errors: deploymentErrors,
    });
    pushGooglePlayRolloutErrors({ label, rolloutPolicy, errors: deploymentErrors });
    pushSmokePolicyErrors({ label, protectionClass, smoke, errors: deploymentErrors });
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
      provider: GOOGLE_PLAY_PROVIDER,
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
      component: { kind: MOBILE_APP_COMPONENT_KIND, target: componentTarget },
      components: [
        {
          id: primaryComponent?.id || "default",
          kind: MOBILE_APP_COMPONENT_KIND,
          target: primaryComponent?.target || componentTarget,
        },
      ],
      publisher: { type: publisher, config: publisherConfig },
      providerTarget: deriveGooglePlayProviderTarget({
        developerAccount,
        app,
        packageName,
        platform,
        track,
        signingModel,
      }),
    });
  }
  for (const duplicate of duplicateValueEntries(
    deployments.map((deployment) => ({
      value: deployment.providerTarget.providerTargetIdentity,
      label: deployment.label,
    })),
  )) {
    for (const label of duplicate.labels) {
      context.errors.push(
        deploymentError(
          label,
          `duplicate provider_target identity "${duplicate.value}" collides with ${duplicate.labels.join(", ")}`,
        ),
      );
    }
  }
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
