#!/usr/bin/env zx-wrapper
import { normalizeTargetLabel } from "../lib/labels.ts";
import type { GraphNode } from "../lib/graph.ts";

const FORBIDDEN_SOURCE_RESPONSE_FIELDS = new Set([
  "forensicFields",
  "rawForensics",
  "providerEvidence",
  "internalTrace",
]);

export function appTargetBoundaryErrors(nodes: GraphNode[]): string[] {
  const appNodes = nodes
    .map((node) => ({ node, label: normalizeTargetLabel(String(node.name || "")) }))
    .filter((entry) => entry.label.startsWith("//projects/apps/"));
  const appRoots = new Map(appNodes.map((entry) => [entry.label, appRoot(entry.label)]));
  const errors: string[] = [];
  for (const { node, label } of appNodes) {
    for (const dep of dependencyLabels(node)) {
      const normalizedDep = normalizeTargetLabel(dep);
      const depRoot = appRoots.get(normalizedDep) || appRoot(normalizedDep);
      if (depRoot && depRoot !== appRoot(label)) {
        errors.push(`${label}: app target must not import app target ${normalizedDep}`);
      }
    }
  }
  return errors.sort();
}

export function mcpSourceResponseBoundaryErrors(responseShape: unknown): string[] {
  const errors: string[] = [];
  visitShape(responseShape, [], errors);
  return errors;
}

function dependencyLabels(node: GraphNode): string[] {
  const deps = Array.isArray(node.deps) ? node.deps : [];
  return deps
    .map((dep) => {
      if (typeof dep === "string") return dep;
      if (
        dep &&
        typeof dep === "object" &&
        typeof (dep as { label?: unknown }).label === "string"
      ) {
        return String((dep as { label: string }).label);
      }
      return "";
    })
    .filter(Boolean);
}

function appRoot(label: string): string {
  const parts = label.split("/");
  return parts.length >= 5 && parts[0] === "" && parts[2] === "projects" && parts[3] === "apps"
    ? `//projects/apps/${parts[4].split(":")[0]}`
    : "";
}

function visitShape(value: unknown, path: string[], errors: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitShape(entry, [...path, String(index)], errors));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (FORBIDDEN_SOURCE_RESPONSE_FIELDS.has(key)) {
      errors.push(`MCP source response exposes forbidden field ${nextPath.join(".")}`);
    }
    visitShape(nested, nextPath, errors);
  }
}
