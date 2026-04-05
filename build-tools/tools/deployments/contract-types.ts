#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy.ts";
import { packagePathFromLabel } from "../lib/labels.ts";

export const NIXOS_SHARED_HOST_PROVIDER = "nixos-shared-host";
export const CLOUDFLARE_PAGES_PROVIDER = "cloudflare-pages";
export const STATIC_WEBAPP_COMPONENT = "static-webapp";

export type DeploymentPrerequisiteMode = "ordering_only" | "health_gated";

export type DeploymentPrerequisite = {
  deploymentId: string;
  mode: DeploymentPrerequisiteMode;
};

export type DeploymentPreviewIdentitySelector = "branch" | "commit" | "source_run";

export type DeploymentPreviewPolicy = {
  targetDerivation: string;
  isolationClass: string;
  identitySelector: DeploymentPreviewIdentitySelector;
  cleanupTtl: string;
  smokeTarget: "normal_url" | "preview_url";
  lockScope: "shared" | "preview";
};

type DeploymentBase = {
  deploymentId: string;
  label: string;
  name: string;
  protectionClass: string;
  lanePolicyRef: string;
  lanePolicy: DeploymentLanePolicy;
  environmentStage: string;
  admissionPolicyRef: string;
  admissionPolicy: DeploymentAdmissionPolicy;
  prerequisites: DeploymentPrerequisite[];
  component: {
    kind: typeof STATIC_WEBAPP_COMPONENT;
    target: string;
  };
  preview?: DeploymentPreviewPolicy;
};

export type NixosSharedHostProviderTarget = {
  host: "nixos-shared-host";
  appName: string;
  targetGroup: string;
  hostname: string;
  containerName: string;
  sharedDevTargetIdentity: string;
};

export type CloudflarePagesProviderTarget = {
  account: string;
  project: string;
  id: string;
  canonicalUrl: string;
  providerTargetIdentity: string;
  previewBranch?: string;
  previewSourceRunId?: string;
};

export type NixosSharedHostDeployment = DeploymentBase & {
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
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

export type CloudflarePagesDeployment = DeploymentBase & {
  provider: typeof CLOUDFLARE_PAGES_PROVIDER;
  publisher: {
    type: string;
    config: string;
  };
  providerTarget: CloudflarePagesProviderTarget;
};

export type DeploymentTarget = NixosSharedHostDeployment | CloudflarePagesDeployment;

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

export function deriveCloudflarePagesProviderTarget(input: {
  account: string;
  project: string;
  id?: string;
}): CloudflarePagesProviderTarget {
  const account = input.account.trim();
  const project = input.project.trim();
  const id = (input.id || project).trim() || project;
  return {
    account,
    project,
    id,
    canonicalUrl: `https://${project}.pages.dev/`,
    providerTargetIdentity: `${CLOUDFLARE_PAGES_PROVIDER}:${account}/${project}`,
  };
}

export function isNixosSharedHostDeployment(
  deployment: DeploymentTarget,
): deployment is NixosSharedHostDeployment {
  return deployment.provider === NIXOS_SHARED_HOST_PROVIDER;
}

export function isCloudflarePagesDeployment(
  deployment: DeploymentTarget,
): deployment is CloudflarePagesDeployment {
  return deployment.provider === CLOUDFLARE_PAGES_PROVIDER;
}

export function providerTargetIdentityFor(deployment: DeploymentTarget): string {
  return isNixosSharedHostDeployment(deployment)
    ? deployment.providerTarget.sharedDevTargetIdentity
    : deployment.providerTarget.providerTargetIdentity;
}
