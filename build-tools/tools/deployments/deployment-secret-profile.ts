#!/usr/bin/env zx-wrapper
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";
import { deploymentError } from "./contract-extract-shared";

const PROFILE_ALIAS = /^[a-z0-9][a-z0-9-]*$/;
const FORBIDDEN_RUNTIME_KEYS =
  /(^|_)(token|secret_value|client_id|client_secret|access_token|personal_token|service_token)$/;

export function defaultDeploymentSecretBackendProfile(backend: DeploymentSecretBackendKind) {
  return backend === "infisical" ? "infisical-default" : "vault-default";
}

export function isDeploymentSecretBackendProfile(value: string) {
  return PROFILE_ALIAS.test(value);
}

export function pushForbiddenInfisicalRuntimeKeyErrors(opts: {
  label: string;
  runtime: Record<string, string>;
  errors: string[];
}) {
  for (const key of Object.keys(opts.runtime)) {
    if (FORBIDDEN_RUNTIME_KEYS.test(key) && !key.endsWith("_env")) {
      opts.errors.push(deploymentError(opts.label, `infisical_runtime.${key} is forbidden`));
    }
  }
}
