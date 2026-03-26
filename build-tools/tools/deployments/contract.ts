#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { GraphNode } from "../lib/graph.ts";
import { normalizeTargetLabel, packagePathFromLabel } from "../lib/labels.ts";

export const MINI_PROVIDER = "mini-dev-container";
export const STATIC_WEBAPP_COMPONENT = "static-webapp";
const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TARGET_GROUP_RE = APP_NAME_RE;
const SHARED_NONPROD = "shared_nonprod";

export type MiniProviderTarget = {
  host: "mini";
  appName: string;
  targetGroup: string;
  hostname: string;
  containerName: string;
  sharedDevTargetIdentity: string;
};

export type MiniDeployment = {
  deploymentId: string;
  label: string;
  name: string;
  provider: typeof MINI_PROVIDER;
  protectionClass: string;
  component: {
    kind: typeof STATIC_WEBAPP_COMPONENT;
    target: string;
  };
  publisher: { type: string };
  provisioner?: { type: string };
  runtime: {
    appName: string;
    containerPort: number;
    healthPath?: string;
    targetGroup?: string;
  };
  providerTarget: MiniProviderTarget;
};

function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

function readNumber(node: GraphNode, key: string): number {
  const value = node[key];
  return typeof value === "number" ? value : Number(value || 0);
}

function packageBaseName(label: string): string {
  return path.posix.basename(packagePathFromLabel(label));
}

function targetName(label: string): string {
  const normalized = normalizeTargetLabel(label);
  const parts = normalized.split(":");
  return parts[1] || parts[0] || "";
}

function normalizeTargetGroup(targetGroup: string): string {
  return targetGroup.trim() || "default";
}

function isStaticWebappNode(node: GraphNode | undefined): boolean {
  const labels = new Set(Array.isArray(node?.labels) ? node.labels : []);
  return labels.has("kind:app") && (labels.has("webapp:static") || labels.has("webapp:pwa"));
}

function deploymentError(label: string, message: string): string {
  return `${normalizeTargetLabel(label)}: ${message}`;
}

export function deriveMiniProviderTarget(input: {
  appName: string;
  targetGroup?: string;
}): MiniProviderTarget {
  const appName = input.appName.trim();
  const targetGroup = normalizeTargetGroup(input.targetGroup || "");
  return {
    host: "mini",
    appName,
    targetGroup,
    hostname: `${appName}.apps.kilty.io`,
    containerName: appName,
    sharedDevTargetIdentity: `${MINI_PROVIDER}:${targetGroup}:${appName}`,
  };
}

export function extractMiniDeployments(nodes: GraphNode[]): {
  deployments: MiniDeployment[];
  errors: string[];
} {
  const errors: string[] = [];
  const components = new Map<string, GraphNode>();
  for (const node of nodes) {
    const label = normalizeTargetLabel(String(node.name || ""));
    if (label) components.set(label, node);
  }

  const deployments: MiniDeployment[] = [];
  for (const node of nodes) {
    if (readString(node, "provider") !== MINI_PROVIDER) continue;
    const label = normalizeTargetLabel(String(node.name || ""));
    const componentTarget = normalizeTargetLabel(readString(node, "component"));
    const componentKind = readString(node, "component_kind");
    const appName = readString(node, "app_name");
    const containerPort = readNumber(node, "container_port");
    const healthPath = readString(node, "health_path");
    const targetGroup = readString(node, "target_group");
    const protectionClass = readString(node, "protection_class") || SHARED_NONPROD;
    const publisher = readString(node, "publisher");
    const provisioner = readString(node, "provisioner");

    if (!label) {
      errors.push("deployment target missing canonical label");
      continue;
    }
    if (componentKind !== STATIC_WEBAPP_COMPONENT) {
      errors.push(
        deploymentError(
          label,
          `unsupported mini-dev-container component_kind "${componentKind || "<empty>"}"`,
        ),
      );
      continue;
    }
    if (!componentTarget) errors.push(deploymentError(label, "missing required component target"));
    if (!appName) errors.push(deploymentError(label, "missing required app_name"));
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
      errors.push(deploymentError(label, "container_port must be an integer between 1 and 65535"));
    }
    if (appName && !APP_NAME_RE.test(appName)) {
      errors.push(
        deploymentError(
          label,
          "app_name must be a lowercase hostname token without dots or subdomain overrides",
        ),
      );
    }
    if (targetGroup && !TARGET_GROUP_RE.test(targetGroup)) {
      errors.push(
        deploymentError(label, "target_group must be lowercase alphanumeric plus internal hyphens"),
      );
    }
    if (healthPath && !healthPath.startsWith("/")) {
      errors.push(deploymentError(label, "health_path must start with '/' when provided"));
    }
    if (protectionClass !== SHARED_NONPROD) {
      errors.push(
        deploymentError(
          label,
          `mini-dev-container deployments must use protection_class "${SHARED_NONPROD}"`,
        ),
      );
    }
    if (!publisher) errors.push(deploymentError(label, "missing required publisher"));
    if (!provisioner) errors.push(deploymentError(label, "missing required provisioner"));

    const componentNode = components.get(componentTarget);
    if (componentTarget && !isStaticWebappNode(componentNode)) {
      errors.push(
        deploymentError(
          label,
          `component target ${componentTarget || "<empty>"} is not a supported static-webapp`,
        ),
      );
    }
    if (errors.some((entry) => entry.startsWith(`${label}:`))) continue;

    const providerTarget = deriveMiniProviderTarget({ appName, targetGroup });
    deployments.push({
      deploymentId: packageBaseName(label),
      label,
      name: targetName(label),
      provider: MINI_PROVIDER,
      protectionClass,
      component: {
        kind: STATIC_WEBAPP_COMPONENT,
        target: componentTarget,
      },
      publisher: { type: publisher },
      ...(provisioner ? { provisioner: { type: provisioner } } : {}),
      runtime: {
        appName,
        containerPort,
        ...(healthPath ? { healthPath } : {}),
        ...(targetGroup ? { targetGroup } : {}),
      },
      providerTarget,
    });
  }

  const labelsByAppName = new Map<string, string[]>();
  for (const deployment of deployments) {
    const current = labelsByAppName.get(deployment.runtime.appName) || [];
    current.push(deployment.label);
    labelsByAppName.set(deployment.runtime.appName, current);
  }
  for (const [appName, labels] of labelsByAppName) {
    if (labels.length < 2) continue;
    const sortedLabels = [...labels].sort();
    for (const label of sortedLabels) {
      errors.push(
        deploymentError(
          label,
          `duplicate app_name "${appName}" collides on ${appName}.apps.kilty.io with ${sortedLabels.join(", ")}`,
        ),
      );
    }
  }

  return {
    deployments: deployments.sort((a, b) => a.label.localeCompare(b.label)),
    errors: Array.from(new Set(errors)),
  };
}
