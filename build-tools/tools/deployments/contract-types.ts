#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { DeploymentAdmissionPolicy, DeploymentLanePolicy } from "./deployment-policy.ts";
import type { DeploymentRolloutPolicy } from "./deployment-rollout.ts";
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

export type DeploymentComponent = {
  id: string;
  kind: typeof STATIC_WEBAPP_COMPONENT;
  target: string;
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
  rolloutPolicy?: DeploymentRolloutPolicy;
  component: {
    kind: typeof STATIC_WEBAPP_COMPONENT;
    target: string;
  };
  components: DeploymentComponent[];
  preview?: DeploymentPreviewPolicy;
};

export type NixosSharedHostProviderTarget = {
  host: "nixos-shared-host";
  targetGroup: string;
  appNames: string[];
  deploymentTargetIdentity: string;
  appName?: string;
  hostname?: string;
  containerName?: string;
  sharedDevTargetIdentity?: string;
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

export type NixosSharedHostDeploymentComponent = DeploymentComponent & {
  runtime: {
    appName: string;
    containerPort: number;
    healthPath?: string;
    targetGroup?: string;
  };
  providerTarget: NixosSharedHostProviderTarget;
};

export type NixosSharedHostDeployment = DeploymentBase & {
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
  publisher: { type: string };
  provisioner?: { type: string };
  runtime?: NixosSharedHostDeploymentComponent["runtime"];
  components: NixosSharedHostDeploymentComponent[];
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
  appName?: string;
  appNames?: string[];
  targetGroup?: string;
}): NixosSharedHostProviderTarget {
  const appNames = Array.from(
    new Set(
      (input.appNames || [input.appName || ""]).map((appName) => appName.trim()).filter(Boolean),
    ),
  ).sort();
  const targetGroup = normalizeTargetGroup(input.targetGroup || "");
  const deploymentTargetIdentity =
    appNames.length === 1
      ? `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:${appNames[0]}`
      : `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:{${appNames.join(",")}}`;
  return {
    host: "nixos-shared-host",
    targetGroup,
    appNames,
    deploymentTargetIdentity,
    ...(appNames.length === 1
      ? {
          appName: appNames[0],
          hostname: `${appNames[0]}.apps.kilty.io`,
          containerName: appNames[0],
          sharedDevTargetIdentity: `${NIXOS_SHARED_HOST_PROVIDER}:${targetGroup}:${appNames[0]}`,
        }
      : {}),
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

export function isMultiComponentDeployment(deployment: DeploymentTarget): boolean {
  return deployment.components.length > 1;
}

export function componentTargetsFor(deployment: DeploymentTarget): string[] {
  return deployment.components.map((component) => component.target);
}

export function providerTargetIdentityFor(deployment: DeploymentTarget): string {
  return isNixosSharedHostDeployment(deployment)
    ? deployment.providerTarget.deploymentTargetIdentity
    : deployment.providerTarget.providerTargetIdentity;
}
