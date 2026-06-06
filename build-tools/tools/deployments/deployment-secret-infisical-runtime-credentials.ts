#!/usr/bin/env zx-wrapper
import type {
  DeploymentInfisicalRuntimeConfig,
  InfisicalCredentialConfig,
} from "./deployment-secret-infisical-credentials";
import { rejectAmbientInfisicalCredentialEnv } from "./deployment-secret-infisical-credentials";
import { resolveBootstrapSprinkleRefBackend } from "./sprinkleref-bootstrap-guard";
import { readSelectedSprinkleRefConfig } from "./sprinkleref-config-select";
import { createSprinkleRefStore } from "./sprinkleref-store";

export async function resolveInfisicalCredentialFromRuntime(opts: {
  runtime: DeploymentInfisicalRuntimeConfig;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
}): Promise<InfisicalCredentialConfig> {
  const env = opts.env || process.env;
  rejectAmbientInfisicalCredentialEnv(env);
  if (opts.runtime.preferredCredentialSource !== "machine_identity_universal_auth") {
    throw new Error(
      "Infisical credential source must be infisical_machine_identity_universal_auth",
    );
  }
  const clientId =
    readEnv(env, opts.runtime.machineIdentityClientIdEnv) ||
    (await readBootstrapCredentialRef({
      ...opts,
      env,
      ref: opts.runtime.machineIdentityClientIdRef,
    }));
  const clientSecret =
    readEnv(env, opts.runtime.machineIdentityClientSecretEnv) ||
    (await readBootstrapCredentialRef({
      ...opts,
      env,
      ref: opts.runtime.machineIdentityClientSecretRef,
      label: "client secret",
    }));
  if (!clientId) throw new Error("Infisical Universal Auth client id is unset");
  if (!clientSecret) throw new Error("Infisical Universal Auth client secret is unset");
  return { kind: "universal_auth", siteUrl: opts.runtime.siteUrl, clientId, clientSecret };
}

async function readBootstrapCredentialRef(opts: {
  ref?: string;
  env: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchImpl?: typeof fetch;
  label?: string;
}) {
  const ref = opts.ref?.trim();
  if (!ref) return "";
  const config = await readSelectedSprinkleRefConfig("", opts.env);
  const resolved = resolveBootstrapSprinkleRefBackend(config, "bootstrap");
  const store = createSprinkleRefStore(resolved.backend, {
    env: opts.env,
    platform: opts.platform,
    fetchImpl: opts.fetchImpl,
    resolverConfig: config,
  });
  const value = await store.read(ref);
  const label = opts.label || "client id";
  if (!value?.trim()) throw new Error(`Infisical Universal Auth ${label} ref ${ref} is unset`);
  return value.trim();
}

function readEnv(env: NodeJS.ProcessEnv, name: string | undefined): string {
  return name ? String(env[name] || "").trim() : "";
}
