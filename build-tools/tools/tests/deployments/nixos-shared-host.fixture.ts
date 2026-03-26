#!/usr/bin/env zx-wrapper
import {
  deriveNixosSharedHostProviderTarget,
  NIXOS_SHARED_HOST_PROVIDER,
  STATIC_WEBAPP_COMPONENT,
  type NixosSharedHostDeployment,
} from "../../deployments/contract.ts";

export function nixosSharedHostDeploymentFixture(
  overrides: Partial<NixosSharedHostDeployment> = {},
): NixosSharedHostDeployment {
  const appName = overrides.runtime?.appName || "pleomino";
  const targetGroup = overrides.runtime?.targetGroup || "default";
  const providerTarget = {
    ...deriveNixosSharedHostProviderTarget({ appName, targetGroup }),
    ...(overrides.providerTarget || {}),
  };
  return {
    deploymentId: overrides.deploymentId || "pleomino-dev",
    label: overrides.label || "//projects/deployments/pleomino-dev:deploy",
    name: overrides.name || "deploy",
    provider: NIXOS_SHARED_HOST_PROVIDER,
    protectionClass: overrides.protectionClass || "shared_nonprod",
    component: {
      kind: STATIC_WEBAPP_COMPONENT,
      target: overrides.component?.target || "//projects/apps/pleomino:app",
    },
    publisher: overrides.publisher || { type: "nixos-shared-host-static-webapp" },
    provisioner: overrides.provisioner || { type: "nixos-shared-host-manifest" },
    runtime: {
      appName,
      containerPort: overrides.runtime?.containerPort || 3000,
      ...(overrides.runtime?.healthPath ? { healthPath: overrides.runtime.healthPath } : {}),
      ...(overrides.runtime?.targetGroup ? { targetGroup: overrides.runtime.targetGroup } : {}),
    },
    providerTarget,
  };
}
