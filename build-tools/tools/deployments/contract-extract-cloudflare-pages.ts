#!/usr/bin/env zx-wrapper
import {
  CLOUDFLARE_PAGES_PROVIDER,
  deriveCloudflarePagesProviderTarget,
  deploymentIdFromLabel,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type CloudflarePagesDeployment,
} from "./contract-types.ts";
import { readPrimaryDeploymentComponent } from "./contract-extract-components.ts";
import {
  deploymentError,
  duplicateValueEntries,
  readSmokePolicy,
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
import { pushSmokePolicyErrors } from "./deployment-smoke-policy.ts";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding.ts";
import {
  resolveDeploymentMetadataRefs,
  validateExplicitDeploymentRequirements,
} from "./deployment-extract-metadata.ts";
import { readDeploymentRequirements } from "./deployment-requirements.ts";
import { pushCloudflareComponentKindErrors } from "./cloudflare-pages-capability-validation.ts";
import {
  allowsCloudflareAliasCollision,
  pushCloudflarePreviewErrors,
} from "./cloudflare-pages-extract-helpers.ts";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const SHARED_NONPROD = "shared_nonprod";
const PRODUCTION_FACING = "production_facing";

export function extractCloudflarePagesDeploymentsFromContext(
  context: DeploymentExtractionContext,
): CloudflarePagesDeployment[] {
  const deployments: CloudflarePagesDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== CLOUDFLARE_PAGES_PROVIDER) continue;
    const label = readLabel(node, "name");
    const { componentTarget, componentKind, components, primaryComponent } =
      readPrimaryDeploymentComponent(node);
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
    const provisioner = readString(node, "provisioner");
    const providerTarget = readStringRecord(node, "provider_target");
    const prerequisites = readPrerequisites(node, "prerequisites");
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const runtimeConfigRequirements = readDeploymentRequirements(
      node,
      "runtime_config_requirements",
    );
    const releaseActionRefs = readLabelList(node, "release_actions");
    const targetExceptionRefs = readLabelList(node, "target_exceptions");
    const preview = readPreviewPolicy(node, "preview");
    const smoke = readSmokePolicy(node);
    const rolloutPolicy = readRolloutPolicy(node);
    const account = providerTarget.account || "";
    const project = providerTarget.project || "";
    const id = providerTarget.id || project;
    const deploymentErrors: string[] = [];
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    const declaredKind = primaryComponent?.kind || componentKind;
    if (!primaryComponent?.target) {
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    }
    if (components.length > 1) {
      deploymentErrors.push(
        deploymentError(label, "cloudflare-pages does not support multi-component deployments"),
      );
    }
    pushRolloutPolicyFieldErrors({ errors: deploymentErrors, label, rolloutPolicy });
    if (rolloutPolicy) {
      deploymentErrors.push(
        deploymentError(label, "cloudflare-pages does not support explicit rollout_policy"),
      );
    }
    for (const [fieldPath, value, required] of [
      ["provider_target.account", account, true],
      ["provider_target.project", project, true],
      ["provider_target.id", id, false],
    ] as const) {
      pushTokenFieldErrors({
        errors: deploymentErrors,
        label,
        fieldPath,
        value,
        pattern: TARGET_TOKEN_RE,
        required,
        invalidMessage: `${fieldPath} must be lowercase alphanumeric plus internal hyphens`,
      });
    }
    if (protectionClass !== SHARED_NONPROD && protectionClass !== PRODUCTION_FACING) {
      deploymentErrors.push(
        deploymentError(
          label,
          'cloudflare-pages deployments must use protection_class "shared_nonprod" or "production_facing"',
        ),
      );
    }
    if (publisher !== "wrangler-pages") {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported cloudflare-pages publisher "${publisher || "<empty>"}"`,
        ),
      );
    }
    if (!publisherConfig) {
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
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
    if (provisioner) {
      deploymentErrors.push(
        deploymentError(
          label,
          "deployment-owned provisioner is not supported for cloudflare-pages",
        ),
      );
    }
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(
          label,
          "cloudflare-pages does not support protected/shared release_actions",
        ),
      );
    }
    pushCloudflarePreviewErrors(label, preview, deploymentErrors);
    pushSmokePolicyErrors({
      label,
      protectionClass,
      componentKind: STATIC_WEBAPP_COMPONENT,
      smoke,
      errors: deploymentErrors,
    });
    pushCloudflareComponentKindErrors({
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
      provider: CLOUDFLARE_PAGES_PROVIDER,
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
      component: { kind: STATIC_WEBAPP_COMPONENT, target: componentTarget },
      components: [
        {
          id: primaryComponent?.id || "default",
          kind: STATIC_WEBAPP_COMPONENT,
          target: primaryComponent?.target || componentTarget,
        },
      ],
      ...(preview ? { preview } : {}),
      publisher: { type: publisher, config: publisherConfig },
      providerTarget: deriveCloudflarePagesProviderTarget({ account, project, id }),
    });
  }
  for (const duplicate of duplicateValueEntries(
    deployments.map((deployment) => ({
      value: deployment.providerTarget.providerTargetIdentity,
      label: deployment.label,
    })),
  )) {
    if (allowsCloudflareAliasCollision(deployments, duplicate.value)) continue;
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
