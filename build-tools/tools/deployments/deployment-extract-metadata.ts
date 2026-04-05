#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import {
  type DeploymentRequirement,
  validateDeploymentRequirements,
} from "./deployment-requirements.ts";

function deploymentExtractionError(label: string, message: string): string {
  return `${label}: ${message}`;
}

export function validateExplicitDeploymentRequirements(opts: {
  node: GraphNode;
  label: string;
  fieldPath: string;
  requirements: DeploymentRequirement[];
  errors: string[];
}) {
  if (!Object.prototype.hasOwnProperty.call(opts.node, opts.fieldPath)) {
    opts.errors.push(deploymentExtractionError(opts.label, `missing required ${opts.fieldPath}`));
  }
  validateDeploymentRequirements(opts);
}

export function resolveDeploymentMetadataRefs<T>(opts: {
  refs: string[];
  label: string;
  kind: "release_action" | "target_exception";
  values: Map<string, T>;
  errors: string[];
}): T[] {
  return opts.refs.flatMap((ref) => {
    const value = opts.values.get(ref);
    if (!value) {
      opts.errors.push(
        deploymentExtractionError(opts.label, `${opts.kind} target not found: ${ref}`),
      );
    }
    return value ? [value] : [];
  });
}
