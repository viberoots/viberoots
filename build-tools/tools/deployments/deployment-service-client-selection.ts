#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { type NixosSharedHostResolvedServiceClient } from "./nixos-shared-host-service-client-config";
import { resolveServiceClientFromCliProfileOrFlags } from "./deployment-service-client-profile";
import { resolveControlPlaneTokenRef } from "./deployment-control-plane-token-ref";
import { deploymentSecretContext } from "./deployment-secret-context";

type SelectionSource = "context" | "explicit_override" | "explicit" | "ambient";

export type SelectedDeploymentServiceClient = NixosSharedHostResolvedServiceClient & {
  selectedSource: SelectionSource;
  requestId?: string;
};

export type DeploymentServiceClientSelectionEvidence = Pick<
  SelectedDeploymentServiceClient,
  "controlPlaneUrl" | "controlPlaneName" | "controlPlaneTokenRef"
> & { source: SelectionSource };

function selectedContext(deployment: DeploymentTarget) {
  return deployment.protectionClass === "local_only" ? undefined : deployment.controlPlane;
}

function selectedDeploymentContextName(deployment: DeploymentTarget) {
  if (deployment.protectionClass === "local_only") return "";
  return String(deployment.deploymentContext?.name || "").trim();
}

export function shouldUseProtectedSharedServiceRoute(opts: {
  deployment: DeploymentTarget;
  requireServiceForProtectedShared: boolean;
  controlPlaneUrl?: string;
  remote?: string;
  env?: NodeJS.ProcessEnv;
}) {
  if (opts.deployment.protectionClass === "local_only") return false;
  return Boolean(
    opts.requireServiceForProtectedShared ||
      opts.deployment.controlPlane ||
      selectedDeploymentContextName(opts.deployment) ||
      String(opts.controlPlaneUrl || "").trim() ||
      String(opts.remote || "").trim() ||
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

function assertRawTokenDoesNotOverrideSelectedRef(opts: {
  contextName: string;
  tokenRef: string;
  token: string | undefined;
}) {
  if (!String(opts.token || "").trim()) return;
  throw new Error(
    `--control-plane-token cannot override deployment context controlPlane ${opts.contextName} token ref ${opts.tokenRef}; selected protected/shared control-plane tokens must resolve from secret:// or runtime:// refs`,
  );
}

export function assertProtectedSharedServiceSelectionInputs(opts: {
  deployment: DeploymentTarget;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
  allowControlPlaneOverride?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const contextSelection = selectedContext(opts.deployment);
  const deploymentContextName = selectedDeploymentContextName(opts.deployment);
  if (!contextSelection && deploymentContextName) {
    throw new Error(
      `protected/shared deployment context ${deploymentContextName} must select a valid controlPlane; rejecting --control-plane-url, VBR_DEPLOY_CONTROL_PLANE_URL, --remote, and ambient token fallback`,
    );
  }
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
  assertRawTokenDoesNotOverrideSelectedRef({
    contextName: contextSelection.name,
    tokenRef: contextSelection.serviceClient.controlPlaneTokenRef,
    token: opts.controlPlaneToken,
  });
}

async function resolveContextToken(opts: {
  tokenRef: string;
  deployment: DeploymentTarget;
  workspaceRoot?: string;
  env: NodeJS.ProcessEnv;
}) {
  const contextName = selectedDeploymentContextName(opts.deployment);
  if (opts.tokenRef.startsWith("secret://")) {
    if (!contextName) {
      throw new Error(
        `selected controlPlaneTokenRef ${opts.tokenRef} requires a selected deployment context before resolving protected/shared service credentials`,
      );
    }
    if (!opts.deployment.secretBackend) {
      throw new Error(
        `selected controlPlaneTokenRef ${opts.tokenRef} requires an explicit deployment secret backend before resolving protected/shared service credentials`,
      );
    }
  }
  return resolveControlPlaneTokenRef({
    tokenRef: opts.tokenRef,
    backend: opts.deployment.secretBackend,
    backendProfile: opts.deployment.secretBackendProfile,
    contextName,
    targetScope: `control-plane:${opts.deployment.deploymentId}`,
    vaultRuntime: opts.deployment.vaultRuntime,
    infisicalRuntime: opts.deployment.infisicalRuntime,
    infisicalSecretMappings: opts.deployment.infisicalSecretMappings,
    secretContext: deploymentSecretContext(),
    requireRealSecretContext: opts.tokenRef.startsWith("secret://"),
    workspaceRoot: opts.workspaceRoot,
    env: opts.env,
  });
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
  assertProtectedSharedServiceSelectionInputs({
    deployment: opts.deployment,
    controlPlaneUrl: explicitUrl,
    controlPlaneToken: opts.controlPlaneToken,
    remote: opts.remote,
    allowControlPlaneOverride: opts.allowControlPlaneOverride,
    env,
  });
  if (!contextSelection) {
    const remote = String(opts.remote || "").trim();
    if (remote && explicitUrl) {
      throw new Error(
        `--remote ${remote} cannot be combined with --control-plane-url; controlPlanes.${remote}.serviceClient must supply the controlPlaneUrl`,
      );
    }
    if (remote && String(opts.controlPlaneToken || "").trim()) {
      throw new Error(
        `--remote ${remote} cannot be combined with --control-plane-token; controlPlanes.${remote}.serviceClient.controlPlaneTokenRef must supply the token`,
      );
    }
    const serviceClient = await resolveServiceClientFromCliProfileOrFlags({
      workspaceRoot: opts.workspaceRoot || process.cwd(),
      controlPlaneUrl: remote ? undefined : explicitUrl || ambientUrl,
      controlPlaneToken: remote ? undefined : opts.controlPlaneToken,
      remote,
      defaultProfileName: opts.deployment.lanePolicy.defaultClientProfile,
      context: opts.context,
      env,
    });
    return {
      ...serviceClient,
      selectedSource: explicitUrl || remote ? "explicit" : "ambient",
    };
  }
  if (explicitUrl && opts.allowControlPlaneOverride) {
    const token = await resolveContextToken({
      tokenRef: contextSelection.serviceClient.controlPlaneTokenRef,
      deployment: opts.deployment,
      workspaceRoot: opts.workspaceRoot,
      env,
    });
    return {
      controlPlaneUrl: explicitUrl,
      controlPlaneToken: token,
      plan: {
        mode: "control-plane-service",
        controlPlaneUrl: explicitUrl,
      },
      selectedSource: "explicit_override",
      controlPlaneName: contextSelection.name,
      controlPlaneTokenRef: contextSelection.serviceClient.controlPlaneTokenRef,
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
