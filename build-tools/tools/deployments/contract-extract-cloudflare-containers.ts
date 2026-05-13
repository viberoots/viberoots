#!/usr/bin/env zx-wrapper
import {
  CLOUDFLARE_CONTAINERS_PROVIDER,
  deriveCloudflareContainersProviderTarget,
} from "./cloudflare-containers-provider-target";
import {
  deploymentIdFromLabel,
  targetName,
  type CloudflareContainersDeployment,
} from "./contract-types";
import { readPrimaryDeploymentComponent } from "./contract-extract-components";
import {
  deploymentError,
  pushRolloutPolicyFieldErrors,
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
import { resolveDeploymentMetadataRefs } from "./deployment-extract-metadata";
import { readDeploymentRequirements } from "./deployment-requirements";
import { pushSmokePolicyErrors } from "./deployment-smoke-policy";
import { readVaultRuntimeConfig } from "./deployment-vault-runtime-metadata";
import { deploymentSecretMetadata as secretMeta } from "./deployment-secret-metadata";
import { resolveSharedDeploymentPolicies } from "./deployment-policy-binding";
import { pushDuplicateProviderTargetIdentityErrors } from "./provider-target-identity-errors";
import {
  pushCloudflareContainersComponentErrors,
  pushCloudflareContainersIngressErrors,
} from "./cloudflare-containers-validation";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/;
const PROTECTION_CLASSES = new Set(["local_only", "shared_nonprod", "production_facing"]);

function readPositivePort(value: string): number {
  const port = Number(value);
  return Number.isInteger(port) ? port : 0;
}

export function extractCloudflareContainersDeploymentsFromContext(
  context: DeploymentExtractionContext,
): CloudflareContainersDeployment[] {
  const deployments: CloudflareContainersDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== CLOUDFLARE_CONTAINERS_PROVIDER) continue;
    const label = readLabel(node, "name");
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    const { componentTarget, componentKind, components, primaryComponent } =
      readPrimaryDeploymentComponent(node);
    const providerTarget = readStringRecord(node, "provider_target");
    const protectionClass = readString(node, "protection_class") || "shared_nonprod";
    const publisher = readString(node, "publisher");
    const publisherConfig = readString(node, "publisher_config");
    const rolloutPolicy = readRolloutPolicy(node);
    const smoke = readSmokePolicy(node);
    const errors: string[] = [];
    const secretRequirements = readDeploymentRequirements(node, "secret_requirements");
    const secretMetadata = secretMeta(node, label, secretRequirements, errors);
    const ingressMode = providerTarget.ingress_mode || "";
    const containerPort = readPositivePort(providerTarget.container_port || "");
    if (!primaryComponent?.target) errors.push(deploymentError(label, "missing component target"));
    if (components.length > 1) {
      errors.push(deploymentError(label, "cloudflare-containers supports one component"));
    }
    if (!PROTECTION_CLASSES.has(protectionClass)) {
      errors.push(deploymentError(label, "unsupported cloudflare-containers protection_class"));
    }
    pushTokenFieldErrors({
      errors,
      label,
      fieldPath: "provider_target.worker",
      value: providerTarget.worker || "",
      pattern: TARGET_TOKEN_RE,
      invalidMessage: "provider_target.worker must be lowercase alphanumeric plus hyphens",
    });
    if (!ACCOUNT_ID_RE.test(providerTarget.account_id || "")) {
      errors.push(
        deploymentError(
          label,
          "cloudflare_account_id must be a 32-character lowercase Cloudflare account id",
        ),
      );
    }
    if (containerPort < 1 || containerPort > 65535) {
      errors.push(deploymentError(label, "container_port must be between 1 and 65535"));
    }
    if (publisher !== "cloudflare-containers-local") {
      errors.push(
        deploymentError(label, `unsupported cloudflare-containers publisher "${publisher}"`),
      );
    }
    if (!publisherConfig) errors.push(deploymentError(label, "missing publisher_config"));
    pushRolloutPolicyFieldErrors({ errors, label, rolloutPolicy });
    if (rolloutPolicy) {
      errors.push(deploymentError(label, "cloudflare-containers does not support rollout_policy"));
    }
    pushCloudflareContainersComponentErrors({
      label,
      declaredKind: primaryComponent?.kind || componentKind,
      componentTarget: primaryComponent?.target || componentTarget,
      componentNode: context.components.get(primaryComponent?.target || componentTarget),
      errors,
    });
    pushSmokePolicyErrors({
      label,
      protectionClass,
      componentKind: primaryComponent?.kind || componentKind,
      smoke,
      errors,
    });
    const releaseActions = resolveDeploymentMetadataRefs({
      refs: readLabelList(node, "release_actions"),
      label,
      kind: "release_action",
      values: context.releaseActions,
      errors,
    });
    const targetExceptions = resolveDeploymentMetadataRefs({
      refs: readLabelList(node, "target_exceptions"),
      label,
      kind: "target_exception",
      values: context.targetExceptions,
      errors,
    });
    pushCloudflareContainersIngressErrors({
      label,
      deploymentId: deploymentIdFromLabel(label),
      providerTargetIdentity: `${CLOUDFLARE_CONTAINERS_PROVIDER}:${
        providerTarget.account_id || ""
      }/${providerTarget.worker || ""}`,
      protectionClass,
      ingressMode,
      domain: providerTarget.domain || "",
      zoneId: providerTarget.cloudflare_zone_id || "",
      workersDevException: providerTarget.workers_dev_exception === "true",
      targetExceptions,
      errors,
    });
    const { lanePolicy, admissionPolicy } = resolveSharedDeploymentPolicies({
      context,
      label,
      lanePolicyRef: readLabel(node, "lane_policy"),
      admissionPolicyRef: readLabel(node, "admission_policy"),
      environmentStage: readString(node, "environment_stage"),
      errors,
    });
    if (errors.length > 0) {
      context.errors.push(...errors);
      continue;
    }
    deployments.push({
      deploymentId: deploymentIdFromLabel(label),
      label,
      name: targetName(label),
      provider: CLOUDFLARE_CONTAINERS_PROVIDER,
      protectionClass,
      lanePolicyRef: readLabel(node, "lane_policy"),
      lanePolicy: lanePolicy!,
      environmentStage: readString(node, "environment_stage"),
      admissionPolicyRef: readLabel(node, "admission_policy"),
      admissionPolicy: admissionPolicy!,
      prerequisites: readPrerequisites(node, "prerequisites"),
      secretRequirements,
      runtimeConfigRequirements: readDeploymentRequirements(node, "runtime_config_requirements"),
      releaseActions,
      targetExceptions,
      ...secretMetadata,
      ...(smoke ? { smoke } : {}),
      ...(readVaultRuntimeConfig(node) ? { vaultRuntime: readVaultRuntimeConfig(node) } : {}),
      component: { kind: primaryComponent!.kind as any, target: primaryComponent!.target },
      components: components as any,
      publisher: { type: publisher, config: publisherConfig },
      providerTarget: deriveCloudflareContainersProviderTarget({
        accountId: providerTarget.account_id || "",
        worker: providerTarget.worker || "",
        ingressMode,
        domain: providerTarget.domain,
        cloudflareZoneId: providerTarget.cloudflare_zone_id,
        containerPort,
        healthPath: providerTarget.health_path,
        workersDevException: providerTarget.workers_dev_exception === "true",
        sleepAfter: providerTarget.sleep_after,
        maxInstances: providerTarget.max_instances,
      }),
    });
  }
  pushDuplicateProviderTargetIdentityErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
