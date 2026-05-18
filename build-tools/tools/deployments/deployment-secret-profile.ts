#!/usr/bin/env zx-wrapper
import { deploymentError } from "./contract-extract-shared";

const ALLOWED_INFISICAL_RUNTIME_KEYS = [
  "site_url",
  "project_id",
  "environment",
  "secret_path",
  "secret_path_prefix",
  "machine_identity_client_id_env",
  "machine_identity_client_secret_env",
  "machine_identity_client_id_file_name",
  "machine_identity_client_secret_file_name",
  "machine_identity_id",
  "preferred_credential_source",
  "access_token_ttl_seconds",
  "access_token_max_uses",
] as const;
const ALLOWED_INFISICAL_RUNTIME_KEY_SET: ReadonlySet<string> = new Set(
  ALLOWED_INFISICAL_RUNTIME_KEYS,
);

export function pushForbiddenInfisicalRuntimeKeyErrors(opts: {
  label: string;
  runtime: Record<string, unknown>;
  errors: string[];
}) {
  for (const key of Object.keys(opts.runtime)) {
    if (!ALLOWED_INFISICAL_RUNTIME_KEY_SET.has(key)) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `infisical_runtime.${key} is unsupported; accepted keys: ${ALLOWED_INFISICAL_RUNTIME_KEYS.join(", ")}`,
        ),
      );
    }
  }
}
