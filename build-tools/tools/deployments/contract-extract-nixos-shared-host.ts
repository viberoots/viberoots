#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import {
  deploymentIdFromLabel,
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  targetName,
  type NixosSharedHostDeployment,
} from "./contract-types.ts";
import {
  createDeploymentExtractionContext,
  deploymentError,
  isStaticWebappNode,
  readLabel,
  readNumber,
  readPreviewPolicy,
  readString,
  type DeploymentExtractionContext,
  uniqueErrors,
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
    const componentTarget = readLabel(node, "component");
    const componentKind = readString(node, "component_kind");
    const lanePolicyRef = readLabel(node, "lane_policy");
    const admissionPolicyRef = readLabel(node, "admission_policy");
    const environmentStage = readString(node, "environment_stage");
    const appName = readString(node, "app_name");
    const containerPort = readNumber(node, "container_port");
    const healthPath = readString(node, "health_path");
    const targetGroup = readString(node, "target_group");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const preview = readPreviewPolicy(node, "preview");
    const publisher = readString(node, "publisher");
    const provisioner = readString(node, "provisioner");
    const deploymentErrors: string[] = [];
    if (!label) {
      context.errors.push("deployment target missing canonical label");
      continue;
    }
    if (componentKind !== STATIC_WEBAPP_COMPONENT) {
      deploymentErrors.push(
        deploymentError(
          label,
          `unsupported nixos-shared-host component_kind "${componentKind || "<empty>"}"`,
        ),
      );
    }
    if (!componentTarget)
      deploymentErrors.push(deploymentError(label, "missing required component target"));
    if (!appName) deploymentErrors.push(deploymentError(label, "missing required app_name"));
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
      deploymentErrors.push(
        deploymentError(label, "container_port must be an integer between 1 and 65535"),
      );
    }
    if (appName && !APP_NAME_RE.test(appName)) {
      deploymentErrors.push(
        deploymentError(
          label,
          "app_name must be a lowercase hostname token without dots or subdomain overrides",
        ),
      );
    }
    if (targetGroup && !TARGET_GROUP_RE.test(targetGroup)) {
      deploymentErrors.push(
        deploymentError(label, "target_group must be lowercase alphanumeric plus internal hyphens"),
      );
    }
    if (healthPath && !healthPath.startsWith("/")) {
      deploymentErrors.push(
        deploymentError(label, "health_path must start with '/' when provided"),
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
    if (!publisher) deploymentErrors.push(deploymentError(label, "missing required publisher"));
    if (!provisioner) deploymentErrors.push(deploymentError(label, "missing required provisioner"));
    if (preview) {
      deploymentErrors.push(
        deploymentError(label, "preview is not supported for nixos-shared-host"),
      );
    }
    const componentNode = context.components.get(componentTarget);
    if (componentTarget && !isStaticWebappNode(componentNode)) {
      deploymentErrors.push(
        deploymentError(
          label,
          `component target ${componentTarget || "<empty>"} is not a supported static-webapp`,
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
      provider: NIXOS_SHARED_HOST_PROVIDER,
      protectionClass,
      lanePolicyRef,
      lanePolicy: lanePolicy!,
      environmentStage,
      admissionPolicyRef,
      admissionPolicy: admissionPolicy!,
      component: { kind: STATIC_WEBAPP_COMPONENT, target: componentTarget },
      publisher: { type: publisher },
      ...(provisioner ? { provisioner: { type: provisioner } } : {}),
      runtime: {
        appName,
        containerPort,
        ...(healthPath ? { healthPath } : {}),
        ...(targetGroup ? { targetGroup } : {}),
      },
      providerTarget: deriveNixosSharedHostProviderTarget({ appName, targetGroup }),
    });
  }
  const labelsByAppName = new Map<string, string[]>();
  for (const deployment of deployments) {
    const labels = labelsByAppName.get(deployment.runtime.appName) || [];
    labels.push(deployment.label);
    labelsByAppName.set(deployment.runtime.appName, labels);
  }
  for (const [appName, labels] of labelsByAppName) {
    if (labels.length < 2) continue;
    const sortedLabels = [...labels].sort();
    for (const label of sortedLabels) {
      context.errors.push(
        deploymentError(
          label,
          `duplicate app_name "${appName}" collides on ${appName}.apps.kilty.io with ${sortedLabels.join(", ")}`,
        ),
      );
    }
  }
  return deployments.sort((a, b) => a.label.localeCompare(b.label));
}

export function extractNixosSharedHostDeployments(nodes: GraphNode[]): {
  deployments: NixosSharedHostDeployment[];
  errors: string[];
} {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractNixosSharedHostDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}
