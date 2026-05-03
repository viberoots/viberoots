#!/usr/bin/env zx-wrapper
import {
  deploymentIdFromLabel,
  deriveVercelProviderTarget,
  SSR_WEBAPP_COMPONENT,
  targetName,
  VERCEL_PROVIDER,
  type VercelDeployment,
} from "./contract-types.ts";
import { readPrimaryDeploymentComponent } from "./contract-extract-components.ts";
import {
  deploymentError,
  duplicateValueEntries,
  readLabel,
  readLabelList,
  readPrerequisites,
  readPreviewPolicy,
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
import { pushSmokePolicyErrors } from "./deployment-smoke-policy.ts";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata.ts";
import { pushVercelComponentKindErrors } from "./vercel-capability-validation.ts";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const SHARED_NONPROD = "shared_nonprod";
const PRODUCTION_FACING = "production_facing";

export function extractVercelDeploymentsFromContext(
  context: DeploymentExtractionContext,
): VercelDeployment[] {
  const deployments: VercelDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== VERCEL_PROVIDER) continue;
    const label = readLabel(node, "name");
    const { componentTarget, componentKind, components, primaryComponent } =
      readPrimaryDeploymentComponent(node);
    const deploymentErrors: string[] = [];
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    const providerTarget = readStringRecord(node, "provider_target");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
    const provisioner = readString(node, "provisioner");
    const rolloutPolicy = readRolloutPolicy(node);
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const runtimeConfigRequirements = readDeploymentRequirements(
      node,
      "runtime_config_requirements",
    );
    const releaseActionRefs = readLabelList(node, "release_actions");
    const targetExceptionRefs = readLabelList(node, "target_exceptions");
    const preview = readPreviewPolicy(node, "preview");
    const smoke = readSmokePolicy(node);
    const vaultRuntime = readVaultRuntimeConfig(node);
    const declaredKind = primaryComponent?.kind || componentKind;
    const team = providerTarget.team || "";
    const project = providerTarget.project || "";
    const environment = providerTarget.environment || "";
    if (!primaryComponent?.target)
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    if (components.length > 1)
      deploymentErrors.push(
        deploymentError(label, "vercel does not support multi-component deployments"),
      );
    if (rolloutPolicy)
      deploymentErrors.push(
        deploymentError(label, "vercel does not support explicit rollout_policy"),
      );
    for (const [fieldPath, value] of [
      ["provider_target.team", team],
      ["provider_target.project", project],
      ["provider_target.environment", environment],
    ] as const) {
      if (!value) deploymentErrors.push(deploymentError(label, `${fieldPath} is required`));
      else if (!TARGET_TOKEN_RE.test(value)) {
        deploymentErrors.push(
          deploymentError(
            label,
            `${fieldPath} must be lowercase alphanumeric plus internal hyphens`,
          ),
        );
      }
    }
    if (protectionClass !== SHARED_NONPROD && protectionClass !== PRODUCTION_FACING) {
      deploymentErrors.push(
        deploymentError(
          label,
          'vercel deployments must use protection_class "shared_nonprod" or "production_facing"',
        ),
      );
    }
    if (publisher !== "vercel-prebuilt") {
      deploymentErrors.push(
        deploymentError(label, `unsupported vercel publisher "${publisher || "<empty>"}"`),
      );
    }
    if (!publisherConfig)
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    if (provisioner)
      deploymentErrors.push(
        deploymentError(label, "deployment-owned provisioner is not supported for vercel"),
      );
    if (releaseActionRefs.length > 0) {
      deploymentErrors.push(
        deploymentError(label, "vercel does not support protected/shared release_actions"),
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
    pushSmokePolicyErrors({
      label,
      protectionClass,
      componentKind: SSR_WEBAPP_COMPONENT,
      smoke,
      errors: deploymentErrors,
    });
    pushVercelComponentKindErrors({
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
      lanePolicyRef: readLabel(node, "lane_policy"),
      admissionPolicyRef: readLabel(node, "admission_policy"),
      environmentStage: readString(node, "environment_stage"),
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
      provider: VERCEL_PROVIDER,
      protectionClass,
      lanePolicyRef: readLabel(node, "lane_policy"),
      lanePolicy: lanePolicy!,
      environmentStage: readString(node, "environment_stage"),
      admissionPolicyRef: readLabel(node, "admission_policy"),
      admissionPolicy: admissionPolicy!,
      prerequisites: readPrerequisites(node, "prerequisites"),
      secretRequirements,
      runtimeConfigRequirements,
      releaseActions,
      targetExceptions,
      ...(smoke ? { smoke } : {}),
      ...(preview ? { preview } : {}),
      ...(vaultRuntime ? { vaultRuntime } : {}),
      component: { kind: SSR_WEBAPP_COMPONENT, target: componentTarget },
      components: [
        {
          id: primaryComponent?.id || "default",
          kind: SSR_WEBAPP_COMPONENT,
          target: primaryComponent?.target || componentTarget,
        },
      ],
      publisher: { type: publisher, config: publisherConfig },
      providerTarget: deriveVercelProviderTarget({
        team,
        project,
        environment,
        canonicalUrl: providerTarget.canonical_url || "",
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
