#!/usr/bin/env zx-wrapper
import {
  CLOUDFLARE_PAGES_PROVIDER,
  deriveCloudflarePagesProviderTarget,
  deploymentIdFromLabel,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type CloudflarePagesDeployment,
} from "./contract-types";
import { readPrimaryDeploymentComponent } from "./contract-extract-components";
import {
  deploymentError,
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
} from "./contract-extract-shared";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata";
import { deploymentSecretMetadata as secretMeta } from "./deployment-secret-metadata";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding";
import {
  resolveDeploymentMetadataRefs,
  validateExplicitDeploymentRequirements,
} from "./deployment-extract-metadata";
import { readDeploymentRequirements } from "./deployment-requirements";
import { pushCloudflareComponentKindErrors } from "./cloudflare-pages-capability-validation";
import * as cloudflarePagesExtract from "./cloudflare-pages-extract-helpers";
const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/,
  [SHARED_NONPROD, PRODUCTION_FACING] = ["shared_nonprod", "production_facing"];
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
    const vaultRuntime = readVaultRuntimeConfig(node);
    const rolloutPolicy = readRolloutPolicy(node);
    const account = providerTarget.account || "";
    const accountId = providerTarget.account_id || "";
    const project = providerTarget.project || "";
    const customDomain = providerTarget.custom_domain || "";
    const deploymentErrors: string[] = [];
    const secretMetadata = secretMeta(node, label, secretRequirements, deploymentErrors);
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
      ["provider_target.id", providerTarget.id || project, false],
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
    if (accountId && !/^[0-9a-f]{32}$/.test(accountId)) {
      deploymentErrors.push(
        deploymentError(
          label,
          "provider_target.account_id must be a 32-character lowercase Cloudflare account id",
        ),
      );
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
    cloudflarePagesExtract.pushCloudflarePreviewErrors(label, preview, deploymentErrors);
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
      deploymentFamily: readString(node, "deployment_family") || undefined,
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
      providerTarget: deriveCloudflarePagesProviderTarget({
        account,
        accountId,
        project,
        id: providerTarget.id || project,
        customDomain,
        customDomainZoneId: providerTarget.custom_domain_zone_id || "",
      }),
    });
  }
  cloudflarePagesExtract.pushDuplicateCloudflareTargetIdentityErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
