#!/usr/bin/env zx-wrapper
import type { NixosSharedHostClientManifest } from "./nixos-shared-host-install-contract";
import { validateProtectedSharedServiceTransport } from "./deployment-service-transport-policy";
import { readProjectConfigSync } from "./project-config";

export type NixosSharedHostServiceClientPlan = {
  mode: "control-plane-service";
  controlPlaneUrl: string;
  controlPlaneTokenEnv?: string;
};

export type NixosSharedHostResolvedServiceClient = {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  plan: NixosSharedHostServiceClientPlan;
};

function requireNonEmpty(value: string | undefined, message: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

export function serviceClientPlanFromManifest(
  manifest: NixosSharedHostClientManifest,
  env: NodeJS.ProcessEnv = process.env,
): NixosSharedHostServiceClientPlan {
  const controlPlaneUrl = validateProtectedSharedServiceTransport({
    controlPlaneUrl: requireNonEmpty(
      manifest.serviceClient?.controlPlaneUrl,
      `profile "${manifest.profileName}" is missing serviceClient.controlPlaneUrl`,
    ),
    context: `profile "${manifest.profileName}" control-plane service`,
    env,
  });
  return {
    mode: "control-plane-service",
    controlPlaneUrl,
    ...(manifest.serviceClient.controlPlaneTokenEnv
      ? { controlPlaneTokenEnv: manifest.serviceClient.controlPlaneTokenEnv }
      : {}),
  };
}

export function resolveServiceTokenFromEnv(
  tokenEnv: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!tokenEnv) return undefined;
  const token = String(env[tokenEnv] || "").trim();
  return token || undefined;
}

export function requireServiceTokenFromEnv(
  tokenEnv: string | undefined,
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const token = resolveServiceTokenFromEnv(tokenEnv, env);
  if (tokenEnv && !token) {
    throw new Error(
      `${context} requires ${tokenEnv} to be set because the selected client profile stores serviceClient.controlPlaneTokenEnv=${tokenEnv}`,
    );
  }
  return token;
}

export function resolveServiceClientFromManifest(
  manifest: NixosSharedHostClientManifest,
  env: NodeJS.ProcessEnv = process.env,
): NixosSharedHostResolvedServiceClient {
  const plan = serviceClientPlanFromManifest(manifest, env);
  const controlPlaneToken = requireServiceTokenFromEnv(
    plan.controlPlaneTokenEnv,
    `profile "${manifest.profileName}" control-plane service`,
    env,
  );
  return {
    controlPlaneUrl: plan.controlPlaneUrl,
    ...(controlPlaneToken ? { controlPlaneToken } : {}),
    plan,
  };
}

export function resolveServiceClientFromFlags(opts: {
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
  env?: NodeJS.ProcessEnv;
  context: string;
}): NixosSharedHostResolvedServiceClient {
  const env = opts.env || process.env;
  const remote = String(opts.remote || "").trim();
  const remoteProfile = remote ? readRemoteControlPlaneProfile(remote, env) : undefined;
  const ambientControlPlaneUrl = String(env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim();
  const controlPlaneUrl = validateProtectedSharedServiceTransport({
    controlPlaneUrl: requireNonEmpty(
      opts.controlPlaneUrl || remoteProfile?.controlPlaneUrl || ambientControlPlaneUrl,
      `${opts.context} requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL for commands without deployment context, or --remote <name> matching projects/config/shared.json controlPlanes.<name>; protected/shared deployments should normally select deployment_context controlPlane`,
    ),
    context: opts.context,
    env,
  });
  const controlPlaneToken = String(opts.controlPlaneToken || "").trim();
  const envToken = String(env.VBR_DEPLOY_CONTROL_PLANE_TOKEN || "").trim();
  return {
    controlPlaneUrl,
    ...(controlPlaneToken || envToken ? { controlPlaneToken: controlPlaneToken || envToken } : {}),
    plan: {
      mode: "control-plane-service",
      controlPlaneUrl,
      ...(controlPlaneToken || envToken
        ? { controlPlaneTokenEnv: "VBR_DEPLOY_CONTROL_PLANE_TOKEN" }
        : {}),
    },
  };
}

function readRemoteControlPlaneProfile(
  remote: string,
  env: NodeJS.ProcessEnv,
): {
  controlPlaneUrl: string;
  controlPlaneTokenRef: string;
} {
  const profile = readProjectConfigSync().config.controlPlanes?.[remote];
  if (!isRecord(profile)) {
    throw new Error(
      `--remote ${remote} requires a matching projects/config/shared.json controlPlanes.${remote} profile`,
    );
  }
  const serviceClient = profile.serviceClient;
  if (!isRecord(serviceClient)) {
    throw new Error(`controlPlanes.${remote}.serviceClient is required for --remote ${remote}`);
  }
  const controlPlaneUrl = String(serviceClient.controlPlaneUrl || "").trim();
  const controlPlaneTokenRef = String(serviceClient.controlPlaneTokenRef || "").trim();
  if (!controlPlaneUrl) {
    throw new Error(`controlPlanes.${remote}.serviceClient.controlPlaneUrl is required`);
  }
  if (!/^(secret|runtime):\/\/.+/.test(controlPlaneTokenRef)) {
    throw new Error(
      `controlPlanes.${remote}.serviceClient.controlPlaneTokenRef must be a secret:// or runtime:// ref`,
    );
  }
  return {
    controlPlaneUrl: validateProtectedSharedServiceTransport({
      controlPlaneUrl,
      context: `controlPlanes.${remote}.serviceClient`,
      env,
    }),
    controlPlaneTokenRef,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
