#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
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
  isStaticWebappNode,
  pushRolloutPolicyFieldErrors,
  pushTokenFieldErrors,
  readLabel,
  readPrerequisites,
  readPreviewPolicy,
  readRolloutPolicy,
  readString,
  readStringRecord,
  type DeploymentExtractionContext,
  duplicateValueEntries,
} from "./contract-extract-shared.ts";

const TARGET_TOKEN_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/;
const SHARED_NONPROD = "shared_nonprod";
const PRODUCTION_FACING = "production_facing";

function validProtectionClass(value: string): boolean {
  return value === SHARED_NONPROD || value === PRODUCTION_FACING;
}

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
    const preview = readPreviewPolicy(node, "preview");
    const rolloutPolicy = readRolloutPolicy(node);
    const account = providerTarget.account || "";
    const project = providerTarget.project || "";
    const id = providerTarget.id || project;
    const deploymentErrors: string[] = [];
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    if ((primaryComponent?.kind || componentKind) !== STATIC_WEBAPP_COMPONENT) {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported cloudflare-pages component_kind "${primaryComponent?.kind || componentKind || "<empty>"}"`,
        ),
      );
    }
    if (!primaryComponent?.target)
      deploymentErrors.push(deploymentError(label, "missing required component target"));
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
    if (!validProtectionClass(protectionClass)) {
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
    if (!publisherConfig)
      deploymentErrors.push(deploymentError(label, "missing required publisher_config"));
    if (provisioner) {
      deploymentErrors.push(
        deploymentError(
          label,
          "deployment-owned provisioner is not supported for cloudflare-pages",
        ),
      );
    }
    if (preview) {
      if (preview.targetDerivation !== "provider_managed_source_run") {
        deploymentErrors.push(
          deploymentError(
            label,
            'preview.target_derivation must be "provider_managed_source_run"; preview must not reuse the normal live target',
          ),
        );
      }
      if (preview.isolationClass !== "isolated") {
        deploymentErrors.push(deploymentError(label, 'preview.isolation_class must be "isolated"'));
      }
      if (preview.identitySelector !== "source_run") {
        deploymentErrors.push(
          deploymentError(label, 'cloudflare-pages preview.identity_selector must be "source_run"'),
        );
      }
      if (preview.smokeTarget !== "preview_url") {
        deploymentErrors.push(
          deploymentError(label, 'cloudflare-pages preview.smoke_target must be "preview_url"'),
        );
      }
      if (preview.lockScope !== "shared") {
        deploymentErrors.push(
          deploymentError(label, 'cloudflare-pages preview.lock_scope must currently be "shared"'),
        );
      }
    }
    const componentNode = context.components.get(primaryComponent?.target || "");
    if (primaryComponent?.target && !isStaticWebappNode(componentNode)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `component target ${primaryComponent.target} is not a supported static-webapp`,
        ),
      );
    }
    if (!lanePolicyRef)
      deploymentErrors.push(deploymentError(label, "missing required lane_policy"));
    if (!environmentStage) {
      deploymentErrors.push(deploymentError(label, "missing required environment_stage"));
    }
    if (!admissionPolicyRef) {
      deploymentErrors.push(deploymentError(label, "missing required admission_policy"));
    }
    const lanePolicy = context.lanePolicies.get(lanePolicyRef);
    if (lanePolicyRef && !lanePolicy) {
      deploymentErrors.push(
        deploymentError(label, `lane_policy target not found: ${lanePolicyRef}`),
      );
    }
    const admissionPolicy = context.admissionPolicies.get(admissionPolicyRef);
    if (admissionPolicyRef && !admissionPolicy) {
      deploymentErrors.push(
        deploymentError(label, `admission_policy target not found: ${admissionPolicyRef}`),
      );
    }
    if (lanePolicy) {
      if (!lanePolicy.stages.includes(environmentStage)) {
        deploymentErrors.push(
          deploymentError(
            label,
            `environment_stage "${environmentStage}" is not defined by lane_policy ${lanePolicyRef}`,
          ),
        );
      }
      const stageBranch = lanePolicy.stageBranches[environmentStage];
      if (admissionPolicy && stageBranch && !admissionPolicy.allowedRefs.includes(stageBranch)) {
        deploymentErrors.push(
          deploymentError(
            label,
            `admission_policy ${admissionPolicyRef} must allow stage branch ${stageBranch}`,
          ),
        );
      }
    }
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
