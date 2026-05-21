#!/usr/bin/env zx-wrapper
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { DeploymentLanePolicy } from "./deployment-policy";
import { isStaleEnvironmentBranchRef } from "./deployment-source-ref-policy";

function packageBaseName(label: string): string {
  return path.posix.basename(packagePathFromLabel(label));
}

function canonicalDeploymentId(label: string): string | undefined {
  const packagePath = packagePathFromLabel(label);
  const prefix = "projects/deployments/";
  if (!packagePath.startsWith(prefix)) return undefined;
  const parts = packagePath.slice(prefix.length).split("/");
  if (parts.length !== 2) return undefined;
  return `${parts[0]}-${parts[1]}`;
}

export function targetName(label: string): string {
  const parts = label.split(":");
  return parts[1] || parts[0] || "";
}

export function deploymentIdFromLabel(label: string): string {
  return canonicalDeploymentId(label) || packageBaseName(label);
}

export function requiredDeploymentSourceRef(deployment: {
  lanePolicy: DeploymentLanePolicy;
  environmentStage: string;
  admissionPolicy?: { allowedRefs: string[] };
}): string {
  const sourceRef = deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage];
  if (!sourceRef) {
    throw new Error(
      `lane policy ${deployment.lanePolicy.ref} does not define source ref for ${deployment.environmentStage}`,
    );
  }
  if (isStaleEnvironmentBranchRef(sourceRef)) {
    throw new Error(`source_ref_policy must not use environment branch ${sourceRef}`);
  }
  return sourceRef;
}
