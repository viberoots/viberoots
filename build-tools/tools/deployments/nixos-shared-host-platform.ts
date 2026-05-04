#!/usr/bin/env zx-wrapper
import { NIXOS_SHARED_HOST_PROVIDER, type NixosSharedHostDeployment } from "./contract";

export type NixosSharedHostPlatformState = {
  version: 1;
  provider: typeof NIXOS_SHARED_HOST_PROVIDER;
  host: "nixos-shared-host";
  deployments: NixosSharedHostDeployment[];
};

function sortDeployments(deployments: NixosSharedHostDeployment[]): NixosSharedHostDeployment[] {
  return [...deployments].sort((a, b) => a.deploymentId.localeCompare(b.deploymentId));
}

function platformComponents(deployments: NixosSharedHostDeployment[]) {
  return deployments.flatMap((deployment) =>
    deployment.components.map((component) => ({
      label: `${deployment.label}#${component.id}`,
      hostname: component.providerTarget.hostname || "",
      sharedDevTargetIdentity: component.providerTarget.sharedDevTargetIdentity || "",
    })),
  );
}

function duplicateValueErrors<T extends { label: string }>(
  entries: T[],
  readKey: (entry: T) => string,
  describe: (value: string, labels: string[]) => string,
): string[] {
  const labelsByKey = new Map<string, string[]>();
  for (const entry of entries) {
    const key = readKey(entry).trim();
    if (!key) continue;
    const labels = labelsByKey.get(key) || [];
    labels.push(entry.label);
    labelsByKey.set(key, labels);
  }
  const errors: string[] = [];
  for (const [key, labels] of labelsByKey) {
    if (labels.length < 2) continue;
    errors.push(describe(key, [...labels].sort()));
  }
  return errors;
}

export function createNixosSharedHostPlatformState(
  deployments: NixosSharedHostDeployment[],
): NixosSharedHostPlatformState {
  return {
    version: 1,
    provider: NIXOS_SHARED_HOST_PROVIDER,
    host: "nixos-shared-host",
    deployments: sortDeployments(deployments),
  };
}

export function validateNixosSharedHostPlatformState(
  state: NixosSharedHostPlatformState,
): string[] {
  const errors: string[] = [];
  if (state.version !== 1)
    errors.push(`nixos-shared-host platform state version must be 1, got ${state.version}`);
  if (state.provider !== NIXOS_SHARED_HOST_PROVIDER) {
    errors.push(
      `nixos-shared-host platform state provider must be "${NIXOS_SHARED_HOST_PROVIDER}", got "${state.provider}"`,
    );
  }
  if (state.host !== "nixos-shared-host") {
    errors.push(
      `nixos-shared-host platform state host must be "nixos-shared-host", got "${state.host}"`,
    );
  }
  for (const deployment of state.deployments) {
    if (deployment.provider !== NIXOS_SHARED_HOST_PROVIDER) {
      errors.push(
        `${deployment.label}: nixos-shared-host platform state only accepts "${NIXOS_SHARED_HOST_PROVIDER}" deployments`,
      );
    }
  }
  errors.push(
    ...duplicateValueErrors(
      state.deployments,
      (deployment) => deployment.deploymentId,
      (value, labels) =>
        `duplicate deployment_id "${value}" in nixos-shared-host platform state: ${labels.join(", ")}`,
    ),
  );
  errors.push(
    ...duplicateValueErrors(
      platformComponents(state.deployments),
      (component) => component.hostname,
      (value, labels) =>
        `duplicate hostname "${value}" in nixos-shared-host platform state: ${labels.join(", ")}`,
    ),
  );
  errors.push(
    ...duplicateValueErrors(
      platformComponents(state.deployments),
      (component) => component.sharedDevTargetIdentity,
      (value, labels) =>
        `duplicate shared-dev target identity "${value}" in nixos-shared-host platform state: ${labels.join(", ")}`,
    ),
  );
  return Array.from(new Set(errors));
}

function validatedState(deployments: NixosSharedHostDeployment[]): NixosSharedHostPlatformState {
  const state = createNixosSharedHostPlatformState(deployments);
  const errors = validateNixosSharedHostPlatformState(state);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return state;
}

export function applyNixosSharedHostScopedDeployments(
  current: NixosSharedHostPlatformState,
  scopedDeployments: NixosSharedHostDeployment[],
): NixosSharedHostPlatformState {
  const byDeploymentId = new Map(
    current.deployments.map((deployment) => [deployment.deploymentId, deployment]),
  );
  for (const deployment of scopedDeployments) {
    byDeploymentId.set(deployment.deploymentId, deployment);
  }
  return validatedState(Array.from(byDeploymentId.values()));
}

export function reconcileNixosSharedHostPlatformState(
  deployments: NixosSharedHostDeployment[],
): NixosSharedHostPlatformState {
  return validatedState(deployments);
}

export function removeNixosSharedHostPlatformDeployment(
  current: NixosSharedHostPlatformState,
  deploymentId: string,
): NixosSharedHostPlatformState {
  return validatedState(
    current.deployments.filter((deployment) => deployment.deploymentId !== deploymentId),
  );
}

export function emptyNixosSharedHostPlatformState(): NixosSharedHostPlatformState {
  return createNixosSharedHostPlatformState([]);
}
