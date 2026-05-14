#!/usr/bin/env zx-wrapper
import { deploymentError } from "./contract-extract-shared";
import { isEnvironmentVariableName } from "./deployment-env-name";

const UNIVERSAL_AUTH_ENV_FIELDS = [
  "machine_identity_client_id_env",
  "machine_identity_client_secret_env",
] as const;

export function pushInfisicalUniversalAuthEnvErrors(opts: {
  label: string;
  errors: string[];
  rawRuntimeNode: Record<string, unknown>;
}) {
  for (const field of UNIVERSAL_AUTH_ENV_FIELDS) validateUniversalAuthEnvField(opts, field);
}

function validateUniversalAuthEnvField(
  opts: { label: string; errors: string[]; rawRuntimeNode: Record<string, unknown> },
  field: (typeof UNIVERSAL_AUTH_ENV_FIELDS)[number],
) {
  const value = opts.rawRuntimeNode[field];
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    opts.errors.push(deploymentError(opts.label, `infisical_runtime.${field} is required`));
    return;
  }
  if (typeof value !== "string" || !isEnvironmentVariableName(value.trim())) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `infisical_runtime.${field} must be a valid environment-variable name`,
      ),
    );
  }
}
