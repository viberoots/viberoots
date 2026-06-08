#!/usr/bin/env zx-wrapper
import type { NixosSharedHostClientManifest } from "./nixos-shared-host-install-contract";
import { validateProtectedSharedServiceTransport } from "./deployment-service-transport-policy";
import { readProjectConfigSync } from "./project-config";
import { resolveControlPlaneTokenRef } from "./deployment-control-plane-token-ref";
import { validateControlPlaneProfiles } from "./deployment-control-plane-profile";

export type NixosSharedHostServiceClientPlan = {
  mode: "control-plane-service";
  controlPlaneUrl: string;
  controlPlaneTokenEnv?: string;
};

export type NixosSharedHostResolvedServiceClient = {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  controlPlaneName?: string;
  controlPlaneTokenRef?: string;
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

export async function resolveServiceClientFromFlags(opts: {
  workspaceRoot?: string;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
  env?: NodeJS.ProcessEnv;
  context: string;
}): Promise<NixosSharedHostResolvedServiceClient> {
  const env = opts.env || process.env;
  const remote = String(opts.remote || "").trim();
  const remoteProfile = remote
    ? readRemoteControlPlaneProfile(remote, opts.workspaceRoot || process.cwd(), env)
    : undefined;
  if (remote && String(opts.controlPlaneUrl || "").trim()) {
    throw new Error(
      `--remote ${remote} cannot be combined with --control-plane-url; controlPlanes.${remote}.serviceClient must supply the controlPlaneUrl`,
    );
  }
  if (remote && String(opts.controlPlaneToken || "").trim()) {
    throw new Error(
      `--remote ${remote} cannot be combined with --control-plane-token; controlPlanes.${remote}.serviceClient.controlPlaneTokenRef must supply the token`,
    );
  }
  const ambientControlPlaneUrl = String(env.VBR_DEPLOY_CONTROL_PLANE_URL || "").trim();
  const controlPlaneUrl = validateProtectedSharedServiceTransport({
    controlPlaneUrl: requireNonEmpty(
      remoteProfile?.controlPlaneUrl || opts.controlPlaneUrl || ambientControlPlaneUrl,
      `${opts.context} requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL for commands without deployment context, or --remote <name> matching projects/config/shared.json controlPlanes.<name>; protected/shared deployments should normally select deployment_context controlPlane`,
    ),
    context: opts.context,
    env,
  });
  const controlPlaneToken = String(opts.controlPlaneToken || "").trim();
  const envToken = String(env.VBR_DEPLOY_CONTROL_PLANE_TOKEN || "").trim();
  const remoteToken = remoteProfile
    ? await resolveControlPlaneTokenRef({
        tokenRef: remoteProfile.controlPlaneTokenRef,
        requireRealSecretContext: remoteProfile.controlPlaneTokenRef.startsWith("secret://"),
        workspaceRoot: opts.workspaceRoot,
        env,
      })
    : "";
  const selectedToken = remoteProfile ? remoteToken : controlPlaneToken || envToken;
  const selectedEnvToken = remoteProfile ? "" : controlPlaneToken || envToken;
  return {
    controlPlaneUrl,
    ...(selectedToken ? { controlPlaneToken: selectedToken } : {}),
    ...(remoteProfile
      ? {
          controlPlaneName: remote,
          controlPlaneTokenRef: remoteProfile.controlPlaneTokenRef,
        }
      : {}),
    plan: {
      mode: "control-plane-service",
      controlPlaneUrl,
      ...(selectedEnvToken ? { controlPlaneTokenEnv: "VBR_DEPLOY_CONTROL_PLANE_TOKEN" } : {}),
    },
  };
}

function readRemoteControlPlaneProfile(
  remote: string,
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
): {
  controlPlaneUrl: string;
  controlPlaneTokenRef: string;
} {
  const config = readProjectConfigSync(workspaceRoot).config;
  const errors: string[] = [];
  validateControlPlaneProfiles({
    config,
    label: "projects/config",
    errors,
  });
  if (errors.length > 0) throw new Error(Array.from(new Set(errors)).join("\n"));
  const profile = config.controlPlanes?.[remote];
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
