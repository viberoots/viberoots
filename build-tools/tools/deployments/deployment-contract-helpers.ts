#!/usr/bin/env zx-wrapper
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { DeploymentLanePolicy } from "./deployment-policy";

function packageBaseName(label: string): string {
  return path.posix.basename(packagePathFromLabel(label));
}

export function targetName(label: string): string {
  const parts = label.split(":");
  return parts[1] || parts[0] || "";
}

export function deploymentIdFromLabel(label: string): string {
  return packageBaseName(label);
}

export function requiredDeploymentStageBranch(deployment: {
  lanePolicy: DeploymentLanePolicy;
  environmentStage: string;
}): string {
  const stageBranch = deployment.lanePolicy.stageBranches[deployment.environmentStage];
  if (!stageBranch) {
    throw new Error(
      `lane policy ${deployment.lanePolicy.ref} does not define stage branch for ${deployment.environmentStage}`,
    );
  }
  return stageBranch;
}
