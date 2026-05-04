#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { readStringArray } from "./deployment-graph-readers";
import {
  type DeploymentRequirement,
  validateDeploymentRequirements,
} from "./deployment-requirements";
import {
  isExternalRequirementProfile,
  validateExternalRequirementProfiles,
  type ExternalDeploymentRequirementProfile,
} from "./external-deployment-requirements";

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

export function readExternalRequirementProfiles(
  node: GraphNode,
): ExternalDeploymentRequirementProfile[] {
  return readStringArray(node, "external_requirement_profiles").filter(
    isExternalRequirementProfile,
  );
}

export function validateExternalDeploymentRequirementProfiles(opts: {
  node: GraphNode;
  label: string;
  secretRequirements: DeploymentRequirement[];
  runtimeConfigRequirements: DeploymentRequirement[];
  errors: string[];
}) {
  const rawProfiles = readStringArray(opts.node, "external_requirement_profiles");
  const profiles = rawProfiles.filter(isExternalRequirementProfile);
  for (const profile of rawProfiles) {
    if (!isExternalRequirementProfile(profile)) {
      opts.errors.push(
        deploymentExtractionError(
          opts.label,
          `unsupported external_requirement_profiles entry "${profile}"`,
        ),
      );
    }
  }
  opts.errors.push(
    ...validateExternalRequirementProfiles({
      label: opts.label,
      profiles,
      secretRequirements: opts.secretRequirements,
      runtimeConfigRequirements: opts.runtimeConfigRequirements,
    }),
  );
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
