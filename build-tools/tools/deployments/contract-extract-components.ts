#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import type { DeploymentRolloutPolicy } from "./deployment-rollout.ts";
import {
  deploymentError,
  pushRolloutPolicyFieldErrors,
  readLabel,
  readString,
  readStringRecordList,
} from "./contract-extract-shared.ts";

const STATIC_WEBAPP_COMPONENT = "static-webapp";
const SHARED_NONPROD = "shared_nonprod";

export type RawStaticWebappComponent = {
  id: string;
  kind: string;
  target: string;
  appName: string;
  containerPort: number;
  healthPath: string;
  targetGroup: string;
};

export function readRawStaticWebappComponents(node: GraphNode): RawStaticWebappComponent[] {
  const legacyTarget = readLabel(node, "component");
  const legacyKind = readString(node, "component_kind");
  const legacyAppName = readString(node, "app_name");
  const legacyPort = Number(node.container_port || 0);
  const legacyHealthPath = readString(node, "health_path");
  const legacyTargetGroup = readString(node, "target_group");
  const raw = readStringRecordList(node, "components").map((entry) => ({
    id: entry.id || "",
    kind: entry.kind || "",
    target: normalizeTargetLabel(entry.target || ""),
    appName: entry.app_name || "",
    containerPort: Number(entry.container_port || 0),
    healthPath: entry.health_path || "",
    targetGroup: entry.target_group || legacyTargetGroup,
  }));
  if (raw.length > 0) return raw;
  return [
    {
      id: "default",
      kind: legacyKind,
      target: legacyTarget,
      appName: legacyAppName,
      containerPort: legacyPort,
      healthPath: legacyHealthPath,
      targetGroup: legacyTargetGroup,
    },
  ];
}

export function componentError(label: string, componentId: string, message: string): string {
  return deploymentError(label, `component "${componentId}": ${message}`);
}

export function rolloutPolicyErrorsForNixosSharedHost(
  label: string,
  protectionClass: string,
  components: RawStaticWebappComponent[],
  rolloutPolicy?: DeploymentRolloutPolicy,
): string[] {
  const errors: string[] = [];
  pushRolloutPolicyFieldErrors({ errors, label, rolloutPolicy });
  if (components.length < 2) {
    if (rolloutPolicy && rolloutPolicy.mode !== "all_at_once") {
      errors.push(
        deploymentError(
          label,
          'single-component nixos-shared-host deployments only support rollout_policy.mode "all_at_once"',
        ),
      );
    }
    return errors;
  }
  if (protectionClass !== SHARED_NONPROD && !rolloutPolicy) return errors;
  if (!rolloutPolicy) {
    errors.push(
      deploymentError(
        label,
        "protected/shared multi-component nixos-shared-host deployments must set rollout_policy",
      ),
    );
    return errors;
  }
  if (rolloutPolicy.mode !== "ordered_best_effort") {
    errors.push(
      deploymentError(
        label,
        'multi-component nixos-shared-host deployments only support rollout_policy.mode "ordered_best_effort"',
      ),
    );
  }
  if (rolloutPolicy.abort !== "stop_on_first_failure") {
    errors.push(
      deploymentError(
        label,
        'multi-component nixos-shared-host deployments only support rollout_policy.abort "stop_on_first_failure"',
      ),
    );
  }
  if (rolloutPolicy.smoke !== "final_only") {
    errors.push(
      deploymentError(
        label,
        'multi-component nixos-shared-host deployments only support rollout_policy.smoke "final_only"',
      ),
    );
  }
  const componentIds = components.map((component) => component.id);
  const stepSet = new Set(rolloutPolicy.steps);
  if (rolloutPolicy.steps.length !== componentIds.length || stepSet.size !== componentIds.length) {
    errors.push(
      deploymentError(label, "rollout_policy.steps must list every component id exactly once"),
    );
    return errors;
  }
  if (componentIds.some((componentId) => !stepSet.has(componentId))) {
    errors.push(
      deploymentError(label, "rollout_policy.steps must list every component id exactly once"),
    );
  }
  return errors;
}

export function readPrimaryDeploymentComponent(node: GraphNode): {
  componentTarget: string;
  componentKind: string;
  components: Array<{ id: string; kind: string; target: string }>;
  primaryComponent?: { id: string; kind: string; target: string };
} {
  const componentTarget = readLabel(node, "component");
  const componentKind = readString(node, "component_kind");
  const components = readStringRecordList(node, "components")
    .map((entry) => ({
      id: entry.id || "",
      kind: entry.kind || "",
      target: normalizeTargetLabel(entry.target || ""),
    }))
    .filter((component) => component.id || component.kind || component.target);
  if (components.length > 0) {
    return {
      componentTarget,
      componentKind,
      components,
      primaryComponent: components[0],
    };
  }
  return {
    componentTarget,
    componentKind,
    components: [{ id: "default", kind: STATIC_WEBAPP_COMPONENT, target: componentTarget }],
    primaryComponent: { id: "default", kind: componentKind, target: componentTarget },
  };
}

export function pushDuplicateNixosSharedHostAppNameErrors(
  errors: string[],
  deployments: Array<{
    label: string;
    components: Array<{ id: string; runtime: { appName: string } }>;
  }>,
) {
  const labelsByAppName = new Map<string, string[]>();
  for (const deployment of deployments) {
    for (const component of deployment.components) {
      const labels = labelsByAppName.get(component.runtime.appName) || [];
      labels.push(`${deployment.label}#${component.id}`);
      labelsByAppName.set(component.runtime.appName, labels);
    }
  }
  for (const [appName, labels] of labelsByAppName) {
    if (labels.length < 2) continue;
    const sortedLabels = [...labels].sort();
    for (const label of sortedLabels) {
      errors.push(
        `${label.split("#")[0]}: duplicate app_name "${appName}" collides on ${appName}.apps.kilty.io with ${sortedLabels.join(", ")}`,
      );
    }
  }
}
