#!/usr/bin/env zx-wrapper
import { createRegisteredDeploymentSecretBackend } from "./deployment-secret-backend-registry";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";
import type { DeploymentTarget } from "./contract";
import { type NixosSharedHostResolvedServiceClient } from "./nixos-shared-host-service-client-config";
import { resolveRuntimeTokenBinding } from "./deployment-runtime-token-binding";
import { resolveServiceClientFromCliProfileOrFlags } from "./deployment-service-client-profile";

type SelectionSource = "context" | "explicit_override" | "explicit" | "ambient";

export type SelectedDeploymentServiceClient = NixosSharedHostResolvedServiceClient & {
  selectedSource: SelectionSource;
  controlPlaneName?: string;
  controlPlaneTokenRef?: string;
};

export type DeploymentServiceClientSelectionEvidence = {
  source: SelectionSource;
  controlPlaneUrl: string;
  controlPlaneName?: string;
  controlPlaneTokenRef?: string;
};

function selectedContext(deployment: DeploymentTarget) {
  if (deployment.protectionClass === "local_only") return undefined;
  return deployment.controlPlane;
}

export function shouldUseProtectedSharedServiceRoute(opts: {
  deployment: DeploymentTarget;
  requireServiceForProtectedShared: boolean;
  controlPlaneUrl?: string;
  env?: NodeJS.ProcessEnv;
}) {
  if (opts.deployment.protectionClass === "local_only") return false;
  return Boolean(
    opts.requireServiceForProtectedShared ||
      opts.deployment.controlPlane ||
      String(opts.controlPlaneUrl || "").trim() ||
      String((opts.env || process.env).VBR_DEPLOY_CONTROL_PLANE_URL || "").trim(),
  );
}

export function serviceClientSelectionEvidence(
  client: SelectedDeploymentServiceClient,
): DeploymentServiceClientSelectionEvidence {
  return {
    source: client.selectedSource,
    controlPlaneUrl: client.controlPlaneUrl,
    ...(client.controlPlaneName ? { controlPlaneName: client.controlPlaneName } : {}),
    ...(client.controlPlaneTokenRef ? { controlPlaneTokenRef: client.controlPlaneTokenRef } : {}),
  };
}

function assertMatchingExplicitUrl(opts: {
  contextName: string;
  selectedUrl: string;
  suppliedUrl: string;
  allowOverride: boolean;
}) {
  if (!opts.suppliedUrl || opts.suppliedUrl === opts.selectedUrl || opts.allowOverride) return;
  throw new Error(
    `--control-plane-url ${opts.suppliedUrl} disagrees with deployment context controlPlane ${opts.contextName} (${opts.selectedUrl}); pass --allow-control-plane-override to override explicitly`,
  );
}

function assertAmbientUrlDoesNotOverride(opts: {
  contextName: string;
  selectedUrl: string;
  ambientUrl: string;
}) {
  if (!opts.ambientUrl || opts.ambientUrl === opts.selectedUrl) return;
  throw new Error(
    `VBR_DEPLOY_CONTROL_PLANE_URL ${opts.ambientUrl} disagrees with deployment context controlPlane ${opts.contextName} (${opts.selectedUrl}); ambient control-plane URLs are accepted only for commands without deployment context`,
  );
}

export function assertProtectedSharedServiceSelectionInputs(opts: {
  deployment: DeploymentTarget;
  controlPlaneUrl?: string;
  remote?: string;
  allowControlPlaneOverride?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const contextSelection = selectedContext(opts.deployment);
  if (!contextSelection) return;
  if (String(opts.remote || "").trim()) {
    throw new Error(
      "--remote cannot override deployment context controlPlane; use a named controlPlane profile or pass --allow-control-plane-override with --control-plane-url",
    );
  }
  assertMatchingExplicitUrl({
    contextName: contextSelection.name,
    selectedUrl: contextSelection.serviceClient.controlPlaneUrl,
    suppliedUrl: String(opts.controlPlaneUrl || "").trim(),
    allowOverride: Boolean(opts.allowControlPlaneOverride),
  });
  assertAmbientUrlDoesNotOverride({
    contextName: contextSelection.name,
    selectedUrl: contextSelection.serviceClient.controlPlaneUrl,
    ambientUrl: String((opts.env || process.env).VBR_DEPLOY_CONTROL_PLANE_URL || "").trim(),
  });
}

async function resolveSecretToken(opts: {
  tokenRef: string;
  backend: DeploymentSecretBackendKind;
  backendProfile?: string;
}) {
  const backend = createRegisteredDeploymentSecretBackend({ backend: opts.backend });
  const material = await backend.acquire({
    name: "control_plane_service_token",
    step: "publish",
    contractId: opts.tokenRef,
    required: true,
    backend: opts.backend,
    backendProfile: opts.backendProfile,
    referenceId: `${opts.backend}:${opts.tokenRef}`,
  });
  return material.value;
}

async function resolveContextToken(opts: {
  tokenRef: string;
  deployment: DeploymentTarget;
  workspaceRoot?: string;
  env: NodeJS.ProcessEnv;
}) {
  if (opts.tokenRef.startsWith("secret://")) {
    return await resolveSecretToken({
      tokenRef: opts.tokenRef,
      backend: opts.deployment.secretBackend || "vault",
      backendProfile: opts.deployment.secretBackendProfile,
    });
  }
  if (opts.tokenRef.startsWith("runtime://")) {
    return resolveRuntimeTokenBinding({
      tokenRef: opts.tokenRef,
      workspaceRoot: opts.workspaceRoot,
      env: opts.env,
    });
  }
  throw new Error("controlPlaneTokenRef must be a secret:// or runtime:// ref");
}

export async function resolveProtectedSharedServiceClient(opts: {
  deployment: DeploymentTarget;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
  allowControlPlaneOverride?: boolean;
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
  context: string;
}): Promise<SelectedDeploymentServiceClient> {
  const env = opts.env || process.env;
  const contextSelection = selectedContext(opts.deployment);
  const explicitUrl = String(opts.controlPlaneUrl || "").trim();
  const ambientUrl = String(env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim();
  if (!contextSelection) {
    const serviceClient = await resolveServiceClientFromCliProfileOrFlags({
      workspaceRoot: opts.workspaceRoot || process.cwd(),
      controlPlaneUrl: explicitUrl || ambientUrl,
      controlPlaneToken: opts.controlPlaneToken,
      remote: opts.remote,
      defaultProfileName: opts.deployment.lanePolicy.defaultClientProfile,
      context: opts.context,
      env,
    });
    return {
      ...serviceClient,
      selectedSource: explicitUrl || opts.remote ? "explicit" : "ambient",
    };
  }
  assertProtectedSharedServiceSelectionInputs({
    deployment: opts.deployment,
    controlPlaneUrl: explicitUrl,
    remote: opts.remote,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    env,
  });
  if (explicitUrl && opts.allowControlPlaneOverride) {
    const serviceClient = await resolveServiceClientFromCliProfileOrFlags({
      workspaceRoot: opts.workspaceRoot || process.cwd(),
      controlPlaneUrl: explicitUrl,
      controlPlaneToken: opts.controlPlaneToken,
      context: opts.context,
      env,
    });
    return {
      ...serviceClient,
      selectedSource: "explicit_override",
      controlPlaneName: contextSelection.name,
    };
  }
  const token = await resolveContextToken({
    tokenRef: contextSelection.serviceClient.controlPlaneTokenRef,
    deployment: opts.deployment,
    workspaceRoot: opts.workspaceRoot,
    env,
  });
  return {
    controlPlaneUrl: contextSelection.serviceClient.controlPlaneUrl,
    controlPlaneToken: token,
    plan: {
      mode: "control-plane-service",
      controlPlaneUrl: contextSelection.serviceClient.controlPlaneUrl,
    },
    selectedSource: "context",
    controlPlaneName: contextSelection.name,
    controlPlaneTokenRef: contextSelection.serviceClient.controlPlaneTokenRef,
  };
}
