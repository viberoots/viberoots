#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { normalizeTargetLabel } from "../lib/labels.ts";
import type {
  DeploymentPreviewIdentitySelector,
  DeploymentPreviewPolicy,
} from "./contract-types.ts";
import {
  extractDeploymentAdmissionPolicies,
  extractDeploymentLanePolicies,
  type DeploymentAdmissionPolicy,
  type DeploymentLanePolicy,
} from "./deployment-policy.ts";

export type DeploymentExtractionContext = {
  nodes: GraphNode[];
  components: Map<string, GraphNode>;
  lanePolicies: Map<string, DeploymentLanePolicy>;
  admissionPolicies: Map<string, DeploymentAdmissionPolicy>;
  errors: string[];
};

export function readString(node: GraphNode, key: string): string {
  return typeof node[key] === "string" ? String(node[key]).trim() : "";
}

export function readLabel(node: GraphNode, key: string): string {
  return normalizeTargetLabel(readString(node, key));
}

export function readNumber(node: GraphNode, key: string): number {
  const value = node[key];
  return typeof value === "number" ? value : Number(value || 0);
}

export function readStringRecord(node: GraphNode, key: string): Record<string, string> {
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([entryKey, entryValue]) => typeof entryKey === "string" && typeof entryValue === "string",
      )
      .map(([entryKey, entryValue]) => [entryKey.trim(), String(entryValue).trim()])
      .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
  );
}

export function readPreviewPolicy(
  node: GraphNode,
  key: string,
): DeploymentPreviewPolicy | undefined {
  const preview = readStringRecord(node, key);
  if (Object.keys(preview).length === 0) return undefined;
  return {
    targetDerivation: preview.target_derivation || "",
    isolationClass: preview.isolation_class || "",
    identitySelector: (preview.identity_selector || "") as DeploymentPreviewIdentitySelector,
    cleanupTtl: preview.cleanup_ttl || "7d",
    smokeTarget: (preview.smoke_target || "normal_url") as "normal_url" | "preview_url",
    lockScope: (preview.lock_scope || "shared") as "shared" | "preview",
  };
}

export function isStaticWebappNode(node: GraphNode | undefined): boolean {
  const labels = new Set(Array.isArray(node?.labels) ? node.labels : []);
  return labels.has("kind:app") && (labels.has("webapp:static") || labels.has("webapp:pwa"));
}

export function deploymentError(label: string, message: string): string {
  return `${normalizeTargetLabel(label)}: ${message}`;
}

export function createDeploymentExtractionContext(nodes: GraphNode[]): DeploymentExtractionContext {
  const { policies: lanePolicies, errors: laneErrors } = extractDeploymentLanePolicies(nodes);
  const { policies: admissionPolicies, errors: admissionErrors } =
    extractDeploymentAdmissionPolicies(nodes);
  const components = new Map<string, GraphNode>();
  for (const node of nodes) {
    const label = normalizeTargetLabel(String(node.name || ""));
    if (label) components.set(label, node);
  }
  return {
    nodes,
    components,
    lanePolicies,
    admissionPolicies,
    errors: [...laneErrors, ...admissionErrors],
  };
}

export function uniqueErrors(errors: string[]): string[] {
  return Array.from(new Set(errors));
}
