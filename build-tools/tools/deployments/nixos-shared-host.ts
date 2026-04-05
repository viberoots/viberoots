#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract.ts";
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

function flattenedDeployments(state: NixosSharedHostPlatformState) {
  return state.deployments.flatMap((deployment) =>
    deployment.components.map((component) => ({ deployment, component })),
  );
}

function backendIdentityFor(component: NixosSharedHostDeploymentComponent): string {
  return `${component.providerTarget.containerName}:${component.runtime.containerPort}`;
}

function backendAddressFor(component: NixosSharedHostDeploymentComponent): string {
  return `http://${component.providerTarget.containerName}.nixos-shared-host.internal:${component.runtime.containerPort}`;
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
      flattenedDeployments(state).map(({ deployment, component }) => ({
        label: `${deployment.label}#${component.id}`,
        key: backendIdentityFor(component),
      })),
      (key, labels) =>
        `duplicate backend identity "${key}" in nixos-shared-host config: ${labels.join(", ")}`,
    ),
  );
  if (errors.length > 0) {
    throw new Error(Array.from(new Set(errors)).join("\n"));
  }

  const containers = Object.fromEntries(
    flattenedDeployments(state).map(({ component }) => [
      component.providerTarget.containerName,
      {
        containerName: component.providerTarget.containerName,
        targetGroup: component.providerTarget.targetGroup,
        hostname: component.providerTarget.hostname,
        backendIdentity: backendIdentityFor(component),
        backendAddress: backendAddressFor(component),
        runtime: "static-app-host",
        containerPort: component.runtime.containerPort,
        publishRoot: "/srv/static-app/current",
        releaseRoot: "/srv/static-app/releases",
        activeReleaseLink: "/srv/static-app/live",
        ...(component.runtime.healthPath ? { healthPath: component.runtime.healthPath } : {}),
      },
    ]),
  );

  const nginxVirtualHosts = Object.fromEntries(
    flattenedDeployments(state).map(({ component }) => [
      component.providerTarget.hostname,
      {
        hostname: component.providerTarget.hostname,
        backendIdentity: backendIdentityFor(component),
        backendAddress: backendAddressFor(component),
        targetGroup: component.providerTarget.targetGroup,
        ...(component.runtime.healthPath ? { healthPath: component.runtime.healthPath } : {}),
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
