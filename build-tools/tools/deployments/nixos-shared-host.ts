#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract.ts";
import {
  type NixosSharedHostPlatformState,
  validateNixosSharedHostPlatformState,
} from "./nixos-shared-host-platform.ts";

export type NixosSharedHostContainer = {
  containerName: string;
  targetGroup: string;
  hostname: string;
  backendIdentity: string;
  backendAddress: string;
  runtime: "static-app-host";
  containerPort: number;
  publishRoot: string;
  releaseRoot: string;
  activeReleaseLink: string;
  healthPath?: string;
};

export type NixosSharedHostRoute = {
  hostname: string;
  backendIdentity: string;
  backendAddress: string;
  targetGroup: string;
  healthPath?: string;
};

export type NixosSharedHostConfig = {
  version: 1;
  host: "nixos-shared-host";
  containers: Record<string, NixosSharedHostContainer>;
  nginxVirtualHosts: Record<string, NixosSharedHostRoute>;
};

function backendIdentityFor(deployment: NixosSharedHostDeployment): string {
  return `${deployment.providerTarget.containerName}:${deployment.runtime.containerPort}`;
}

function backendAddressFor(deployment: NixosSharedHostDeployment): string {
  return `http://${deployment.providerTarget.containerName}.nixos-shared-host.internal:${deployment.runtime.containerPort}`;
}

function duplicateKeyErrors(
  entries: Array<{ label: string; key: string }>,
  describe: (key: string, labels: string[]) => string,
): string[] {
  const labelsByKey = new Map<string, string[]>();
  for (const entry of entries) {
    const labels = labelsByKey.get(entry.key) || [];
    labels.push(entry.label);
    labelsByKey.set(entry.key, labels);
  }
  const errors: string[] = [];
  for (const [key, labels] of labelsByKey) {
    if (labels.length < 2) continue;
    errors.push(describe(key, [...labels].sort()));
  }
  return errors;
}

export function renderNixosSharedHostConfig(
  state: NixosSharedHostPlatformState,
): NixosSharedHostConfig {
  const errors = validateNixosSharedHostPlatformState(state);
  errors.push(
    ...duplicateKeyErrors(
      state.deployments.map((deployment) => ({
        label: deployment.label,
        key: backendIdentityFor(deployment),
      })),
      (key, labels) =>
        `duplicate backend identity "${key}" in nixos-shared-host config: ${labels.join(", ")}`,
    ),
  );
  if (errors.length > 0) {
    throw new Error(Array.from(new Set(errors)).join("\n"));
  }

  const containers = Object.fromEntries(
    state.deployments.map((deployment) => [
      deployment.providerTarget.containerName,
      {
        containerName: deployment.providerTarget.containerName,
        targetGroup: deployment.providerTarget.targetGroup,
        hostname: deployment.providerTarget.hostname,
        backendIdentity: backendIdentityFor(deployment),
        backendAddress: backendAddressFor(deployment),
        runtime: "static-app-host",
        containerPort: deployment.runtime.containerPort,
        publishRoot: "/srv/static-app/current",
        releaseRoot: "/srv/static-app/releases",
        activeReleaseLink: "/srv/static-app/live",
        ...(deployment.runtime.healthPath ? { healthPath: deployment.runtime.healthPath } : {}),
      },
    ]),
  );

  const nginxVirtualHosts = Object.fromEntries(
    state.deployments.map((deployment) => [
      deployment.providerTarget.hostname,
      {
        hostname: deployment.providerTarget.hostname,
        backendIdentity: backendIdentityFor(deployment),
        backendAddress: backendAddressFor(deployment),
        targetGroup: deployment.providerTarget.targetGroup,
        ...(deployment.runtime.healthPath ? { healthPath: deployment.runtime.healthPath } : {}),
      },
    ]),
  );

  return {
    version: 1,
    host: "nixos-shared-host",
    containers,
    nginxVirtualHosts,
  };
}
