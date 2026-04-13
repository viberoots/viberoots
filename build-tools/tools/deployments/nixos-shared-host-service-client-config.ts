#!/usr/bin/env zx-wrapper
import type { NixosSharedHostClientManifest } from "./nixos-shared-host-install-contract.ts";

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
): NixosSharedHostServiceClientPlan {
  return {
    mode: "control-plane-service",
    controlPlaneUrl: requireNonEmpty(
      manifest.serviceClient?.controlPlaneUrl,
      `profile "${manifest.profileName}" is missing serviceClient.controlPlaneUrl`,
    ),
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

export function resolveServiceClientFromManifest(
  manifest: NixosSharedHostClientManifest,
  env: NodeJS.ProcessEnv = process.env,
): NixosSharedHostResolvedServiceClient {
  const plan = serviceClientPlanFromManifest(manifest);
  return {
    controlPlaneUrl: plan.controlPlaneUrl,
    ...(plan.controlPlaneTokenEnv
      ? { controlPlaneToken: resolveServiceTokenFromEnv(plan.controlPlaneTokenEnv, env) }
      : {}),
    plan,
  };
}

export function resolveServiceClientFromFlags(opts: {
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  env?: NodeJS.ProcessEnv;
  context: string;
}): NixosSharedHostResolvedServiceClient {
  const env = opts.env || process.env;
  const controlPlaneUrl = requireNonEmpty(
    opts.controlPlaneUrl,
    `${opts.context} requires --control-plane-url or BNX_DEPLOY_CONTROL_PLANE_URL`,
  );
  const controlPlaneToken = String(opts.controlPlaneToken || "").trim();
  const envToken = String(env.BNX_DEPLOY_CONTROL_PLANE_TOKEN || "").trim();
  return {
    controlPlaneUrl,
    ...(controlPlaneToken || envToken ? { controlPlaneToken: controlPlaneToken || envToken } : {}),
    plan: {
      mode: "control-plane-service",
      controlPlaneUrl,
      ...(controlPlaneToken || envToken
        ? { controlPlaneTokenEnv: "BNX_DEPLOY_CONTROL_PLANE_TOKEN" }
        : {}),
    },
  };
}
