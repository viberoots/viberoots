#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels";
import type { GraphNode } from "../lib/graph";
import { readString } from "./deployment-graph-readers";

export const DEPLOYMENT_DEFAULTS_RULE = "deployment_defaults";

export type DeploymentDefaults = {
  ref: string;
  name: string;
  defaultClientProfile?: string;
};

function defaultsError(ref: string, message: string): string {
  return `${normalizeTargetLabel(ref)}: ${message}`;
}

export function extractDeploymentDefaults(nodes: GraphNode[]): {
  defaults: Map<string, DeploymentDefaults>;
  errors: string[];
} {
  const defaults = new Map<string, DeploymentDefaults>();
  const errors: string[] = [];
  for (const node of nodes) {
    if (readString(node, "rule_type") !== DEPLOYMENT_DEFAULTS_RULE) continue;
    const ref = normalizeTargetLabel(String(node.name || ""));
    const name = ref.split(":")[1] || "";
    const defaultClientProfile = readString(node, "default_client_profile");
    if (!ref) {
      errors.push("deployment defaults missing canonical label");
      continue;
    }
    if (!name) errors.push(defaultsError(ref, "deployment defaults must set name"));
    defaults.set(ref, {
      ref,
      name,
      ...(defaultClientProfile ? { defaultClientProfile } : {}),
    });
  }
  return { defaults, errors };
}
