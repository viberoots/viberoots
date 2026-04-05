#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import {
  deploymentIdFromLabel,
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type NixosSharedHostDeployment,
  type NixosSharedHostDeploymentComponent,
} from "./contract-types.ts";
import {
  componentError,
  pushDuplicateNixosSharedHostAppNameErrors,
  readRawStaticWebappComponents,
  rolloutPolicyErrorsForNixosSharedHost,
} from "./contract-extract-components.ts";
import {
  deploymentError,
  isStaticWebappNode,
  readLabel,
  readPrerequisites,
  readPreviewPolicy,
  readRolloutPolicy,
  readString,
  type DeploymentExtractionContext,
} from "./contract-extract-shared.ts";

const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TARGET_GROUP_RE = APP_NAME_RE;
const SHARED_NONPROD = "shared_nonprod";

export function extractNixosSharedHostDeploymentsFromContext(
  context: DeploymentExtractionContext,
): NixosSharedHostDeployment[] {
  const deployments: NixosSharedHostDeployment[] = [];
  for (const node of context.nodes) {
    if (readString(node, "provider") !== NIXOS_SHARED_HOST_PROVIDER) continue;
    const label = readLabel(node, "name");
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const prerequisites = readPrerequisites(node, "prerequisites");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const preview = readPreviewPolicy(node, "preview");
    const publisher = readString(node, "publisher");
    const provisioner = readString(node, "provisioner");
    const rolloutPolicy = readRolloutPolicy(node);
    const deploymentErrors: string[] = [];
    const rawComponents = readRawStaticWebappComponents(node);
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    if (!publisher) deploymentErrors.push(deploymentError(label, "missing required publisher"));
    if (!provisioner) deploymentErrors.push(deploymentError(label, "missing required provisioner"));
    if (preview) {
      deploymentErrors.push(
        deploymentError(label, "preview is not supported for nixos-shared-host"),
      );
    }
    if (protectionClass !== SHARED_NONPROD) {
      deploymentErrors.push(
        deploymentError(
          label,
          `nixos-shared-host deployments must use protection_class "${SHARED_NONPROD}"`,
        ),
      );
    }
    const seenIds = new Set<string>();
    const resolvedComponents: NixosSharedHostDeploymentComponent[] = [];
    for (const rawComponent of rawComponents) {
      if (!rawComponent.id) {
        deploymentErrors.push(deploymentError(label, "components must set id"));
        continue;
      }
      if (seenIds.has(rawComponent.id)) {
        deploymentErrors.push(componentError(label, rawComponent.id, "duplicate component id"));
        continue;
      }
      seenIds.add(rawComponent.id);
      if (rawComponent.kind !== STATIC_WEBAPP_COMPONENT) {
        deploymentErrors.push(
          componentError(
            label,
            rawComponent.id,
            `unsupported nixos-shared-host component_kind "${rawComponent.kind || "<empty>"}"`,
          ),
        );
      }
      if (!rawComponent.target) {
        deploymentErrors.push(
          componentError(label, rawComponent.id, "missing required component target"),
        );
      }
      if (!rawComponent.appName) {
        deploymentErrors.push(componentError(label, rawComponent.id, "missing required app_name"));
      }
      if (
        !Number.isInteger(rawComponent.containerPort) ||
        rawComponent.containerPort < 1 ||
        rawComponent.containerPort > 65535
      ) {
        deploymentErrors.push(
          componentError(
            label,
            rawComponent.id,
            "container_port must be an integer between 1 and 65535",
          ),
        );
      }
      if (rawComponent.appName && !APP_NAME_RE.test(rawComponent.appName)) {
        deploymentErrors.push(
          componentError(
            label,
            rawComponent.id,
            "app_name must be a lowercase hostname token without dots or subdomain overrides",
          ),
        );
      }
      if (rawComponent.targetGroup && !TARGET_GROUP_RE.test(rawComponent.targetGroup)) {
        deploymentErrors.push(
          componentError(
            label,
            rawComponent.id,
            "target_group must be lowercase alphanumeric plus internal hyphens",
          ),
        );
      }
      if (rawComponent.healthPath && !rawComponent.healthPath.startsWith("/")) {
        deploymentErrors.push(
          componentError(label, rawComponent.id, "health_path must start with '/' when provided"),
        );
      }
      const componentNode = context.components.get(rawComponent.target);
      if (rawComponent.target && !isStaticWebappNode(componentNode)) {
        deploymentErrors.push(
          componentError(
            label,
            rawComponent.id,
            `component target ${rawComponent.target} is not a supported static-webapp`,
          ),
        );
      }
      resolvedComponents.push({
        id: rawComponent.id,
        kind: STATIC_WEBAPP_COMPONENT,
        target: rawComponent.target,
        runtime: {
          appName: rawComponent.appName,
          containerPort: rawComponent.containerPort,
          ...(rawComponent.healthPath ? { healthPath: rawComponent.healthPath } : {}),
          ...(rawComponent.targetGroup ? { targetGroup: rawComponent.targetGroup } : {}),
        },
        providerTarget: deriveNixosSharedHostProviderTarget({
          appName: rawComponent.appName,
          targetGroup: rawComponent.targetGroup,
        }),
      });
    }
    const lanePolicy = context.lanePolicies.get(lanePolicyRef);
    const admissionPolicy = context.admissionPolicies.get(admissionPolicyRef);
    if (!lanePolicyRef)
      deploymentErrors.push(deploymentError(label, "missing required lane_policy"));
    if (!environmentStage) {
      deploymentErrors.push(deploymentError(label, "missing required environment_stage"));
    }
    if (!admissionPolicyRef) {
      deploymentErrors.push(deploymentError(label, "missing required admission_policy"));
    }
    if (lanePolicyRef && !lanePolicy) {
      deploymentErrors.push(
        deploymentError(label, `lane_policy target not found: ${lanePolicyRef}`),
      );
    }
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
    const targetGroups = new Set(
      resolvedComponents.map((component) => component.providerTarget.targetGroup),
    );
    if (targetGroups.size > 1) {
      deploymentErrors.push(
        deploymentError(
          label,
          "multi-component nixos-shared-host deployments must resolve to one target_group",
        ),
      );
    }
    deploymentErrors.push(
      ...rolloutPolicyErrorsForNixosSharedHost(
        label,
        protectionClass,
        rawComponents,
        rolloutPolicy,
      ),
    );
    if (deploymentErrors.length > 0) {
      context.errors.push(...deploymentErrors);
      continue;
    }
    deployments.push({
      deploymentId: deploymentIdFromLabel(label),
      label,
      name: targetName(label),
      provider: NIXOS_SHARED_HOST_PROVIDER,
      protectionClass,
      lanePolicyRef,
      lanePolicy: lanePolicy!,
      environmentStage,
      admissionPolicyRef,
      admissionPolicy: admissionPolicy!,
      prerequisites,
      ...(rolloutPolicy ? { rolloutPolicy } : {}),
      component: { kind: STATIC_WEBAPP_COMPONENT, target: resolvedComponents[0]!.target },
      components: resolvedComponents,
      publisher: { type: publisher },
      ...(provisioner ? { provisioner: { type: provisioner } } : {}),
      runtime: resolvedComponents[0]!.runtime,
      providerTarget: deriveNixosSharedHostProviderTarget({
        appNames: resolvedComponents.map((component) => component.runtime.appName),
        targetGroup: resolvedComponents[0]!.providerTarget.targetGroup,
      }),
    });
  }
  pushDuplicateNixosSharedHostAppNameErrors(context.errors, deployments);
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}
