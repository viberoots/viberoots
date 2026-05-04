#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function isMultiComponentNixosSharedHostDeployment(
  deployment: NixosSharedHostDeployment,
): boolean {
  return deployment.components.length > 1;
}

export function nixosSharedHostDeploymentTargetIdentity(
  deployment: NixosSharedHostDeployment,
): string {
  return (
    deployment.providerTarget.deploymentTargetIdentity ||
    deployment.providerTarget.sharedDevTargetIdentity ||
    uniqueSorted(
      deployment.components.map(
        (component) => component.providerTarget.sharedDevTargetIdentity || "",
      ),
    ).join(",")
  );
}

export function nixosSharedHostLockScopes(deployment: NixosSharedHostDeployment): string[] {
  return uniqueSorted(
    deployment.components.map(
      (component) => component.providerTarget.sharedDevTargetIdentity || "",
    ),
  );
}

export function primaryNixosSharedHostComponent(
  deployment: NixosSharedHostDeployment,
): NixosSharedHostDeploymentComponent {
  const component = deployment.components[0];
  if (!component) {
    throw new Error(`deployment has no resolved components: ${deployment.label}`);
  }
  return component;
}

export function orderedNixosSharedHostComponents(
  deployment: NixosSharedHostDeployment,
): NixosSharedHostDeploymentComponent[] {
  if (!isMultiComponentNixosSharedHostDeployment(deployment)) {
    return [primaryNixosSharedHostComponent(deployment)];
  }
  const componentById = new Map(
    deployment.components.map((component) => [component.id, component]),
  );
  return (deployment.rolloutPolicy?.steps || []).map((componentId) => {
    const component = componentById.get(componentId);
    if (!component) {
      throw new Error(`rollout policy references unknown component: ${componentId}`);
    }
    return component;
  });
}
