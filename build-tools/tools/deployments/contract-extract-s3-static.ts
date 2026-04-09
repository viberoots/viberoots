#!/usr/bin/env zx-wrapper
import {
  deploymentIdFromLabel,
  deriveS3StaticProviderTarget,
  S3_STATIC_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type S3StaticDeployment,
} from "./contract-types.ts";
import { readPrimaryDeploymentComponent } from "./contract-extract-components.ts";
import {
  deploymentError,
  duplicateValueEntries,
  pushRolloutPolicyFieldErrors,
  pushTokenFieldErrors,
  readLabel,
  readLabelList,
  readPrerequisites,
  readPreviewPolicy,
  readRolloutPolicy,
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
import { pushS3StaticComponentKindErrors } from "./s3-static-capability-validation.ts";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const SHARED_NONPROD = "shared_nonprod";
const PRODUCTION_FACING = "production_facing";
const BUILT_IN_PROVISIONERS = new Set(["terraform-stack", "cdktf-stack"]);

export function extractS3StaticDeploymentsFromContext(
  context: DeploymentExtractionContext,
): S3StaticDeployment[] {
  const deployments: S3StaticDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== S3_STATIC_PROVIDER) continue;
    const label = readLabel(node, "name");
    const { componentTarget, componentKind, components, primaryComponent } =
      readPrimaryDeploymentComponent(node);
    const providerTarget = readStringRecord(node, "provider_target");
    const deploymentErrors: string[] = [];
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
    const provisioner = readString(node, "provisioner");
    const prerequisites = readPrerequisites(node, "prerequisites");
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const runtimeConfigRequirements = readDeploymentRequirements(
      node,
      "runtime_config_requirements",
    );
    const releaseActionRefs = readLabelList(node, "release_actions");
    const targetExceptionRefs = readLabelList(node, "target_exceptions");
    const preview = readPreviewPolicy(node, "preview");
    const rolloutPolicy = readRolloutPolicy(node);
    const account = providerTarget.account || "";
    const bucket = providerTarget.bucket || "";
    const region = providerTarget.region || "";
    const distribution = providerTarget.distribution || "";
    const declaredKind = primaryComponent?.kind || componentKind;
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (components.length > 1) {
      deploymentErrors.push(
        deploymentError(label, "s3-static does not support multi-component deployments"),
      );
    }
    pushRolloutPolicyFieldErrors({ errors: deploymentErrors, label, rolloutPolicy });
    if (rolloutPolicy && rolloutPolicy.mode !== "all_at_once") {
      deploymentErrors.push(
        deploymentError(
          label,
          `s3-static does not support rollout_policy.mode "${rolloutPolicy.mode}"`,
        ),
      );
    }
    for (const [fieldPath, value, required] of [
      ["provider_target.account", account, true],
      ["provider_target.bucket", bucket, true],
      ["provider_target.region", region, true],
      ["provider_target.distribution", distribution, false],
    ] as const) {
      pushTokenFieldErrors({
        errors: deploymentErrors,
        label,
        fieldPath,
        value,
        pattern: TARGET_TOKEN_RE,
        required,
        invalidMessage: `${fieldPath} must be lowercase alphanumeric plus internal hyphens or dots`,
      });
    }
    if (protectionClass !== SHARED_NONPROD && protectionClass !== PRODUCTION_FACING) {
      deploymentErrors.push(
        deploymentError(
          label,
          's3-static deployments must use protection_class "shared_nonprod" or "production_facing"',
        ),
      );
    }
    if (publisher !== "aws-s3-sync") {
      deploymentErrors.push(
        deploymentError(label, `unsupported s3-static publisher "${publisher || "<empty>"}"`),
      );
    }
    if (!publisherConfig) {
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    }
    if (preview) {
      deploymentErrors.push(deploymentError(label, "s3-static does not support preview"));
    }
    if (provisioner && !BUILT_IN_PROVISIONERS.has(provisioner)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported s3-static provisioner "${provisioner}" (expected terraform-stack or cdktf-stack)`,
        ),
      );
    }
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(label, "s3-static does not support protected/shared release_actions"),
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
    pushS3StaticComponentKindErrors({
      label,
      declaredKind,
      componentTarget: primaryComponent?.target,
      componentNode: context.components.get(primaryComponent?.target || ""),
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
      provider: S3_STATIC_PROVIDER,
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
      ...(rolloutPolicy ? { rolloutPolicy } : {}),
      component: { kind: STATIC_WEBAPP_COMPONENT, target: componentTarget },
      components: [
        {
          id: primaryComponent?.id || "default",
          kind: STATIC_WEBAPP_COMPONENT,
          target: primaryComponent?.target || componentTarget,
        },
      ],
      publisher: { type: publisher, config: publisherConfig },
      ...(provisioner ? { provisioner: { type: provisioner } } : {}),
      providerTarget: deriveS3StaticProviderTarget({ account, bucket, region, distribution }),
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
