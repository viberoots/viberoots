#!/usr/bin/env zx-wrapper
import type { NixosSharedHostClientManifest } from "./nixos-shared-host-install-contract";
import { validateProtectedSharedServiceTransport } from "./deployment-service-transport-policy";

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

const REMOTE_ALIASES: Record<string, string> = {
  mini: "https://deploy.apps.kilty.io",
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
  if (remote && !REMOTE_ALIASES[remote]) {
    throw new Error(`--remote ${remote} is not a known deployment service alias`);
  }
  const controlPlaneUrl = validateProtectedSharedServiceTransport({
    controlPlaneUrl: requireNonEmpty(
      opts.controlPlaneUrl ||
        (remote === "mini"
          ? String(env.VBR_DEPLOY_MINI_CONTROL_PLANE_URL || "").trim() || REMOTE_ALIASES.mini
          : ""),
      `${opts.context} requires --control-plane-url or VBR_DEPLOY_CONTROL_PLANE_URL (or --remote mini)`,
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
