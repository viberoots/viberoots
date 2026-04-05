#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy.ts";
import { packagePathFromLabel } from "../lib/labels.ts";

export const NIXOS_SHARED_HOST_PROVIDER = "nixos-shared-host";
export const STATIC_WEBAPP_COMPONENT = "static-webapp";

export type NixosSharedHostProviderTarget = {
  host: "nixos-shared-host";
  appName: string;
  targetGroup: string;
  hostname: string;
  containerName: string;
  sharedDevTargetIdentity: string;
};

export type NixosSharedHostDeployment = {
  deploymentId: string;
  label: string;
  name: string;
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
  protectionClass: string;
  lanePolicyRef: string;
  lanePolicy: DeploymentLanePolicy;
  environmentStage: string;
  admissionPolicyRef: string;
  admissionPolicy: DeploymentAdmissionPolicy;
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
  providerTarget: NixosSharedHostProviderTarget;
};

function packageBaseName(label: string): string {
  return path.posix.basename(packagePathFromLabel(label));
}

function normalizeTargetGroup(targetGroup: string): string {
  return targetGroup.trim() || "default";
}

export function targetName(label: string): string {
  const parts = label.split(":");
  return parts[1] || parts[0] || "";
}

export function deploymentIdFromLabel(label: string): string {
  return packageBaseName(label);
}

export function deriveNixosSharedHostProviderTarget(input: {
  appName: string;
  targetGroup?: string;
}): NixosSharedHostProviderTarget {
  const appName = input.appName.trim();
  const targetGroup = normalizeTargetGroup(input.targetGroup || "");
  return {
    host: "nixos-shared-host",
    appName,
    targetGroup,
    hostname: `${appName}.apps.kilty.io`,
    containerName: appName,
    sharedDevTargetIdentity: `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:${appName}`,
  };
}
