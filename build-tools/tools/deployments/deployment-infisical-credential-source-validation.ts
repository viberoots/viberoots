#!/usr/bin/env zx-wrapper
import { deploymentError } from "./contract-extract-shared";

const PUBLIC_INFISICAL_CREDENTIAL_SOURCE = "infisical_machine_identity_universal_auth";

export function pushInfisicalCredentialSourceErrors(opts: {
  label: string;
  errors: string[];
  rawRuntimeNode: Record<string, unknown>;
}) {
  const rawSource =
    typeof opts.rawRuntimeNode.preferred_credential_source === "string"
      ? opts.rawRuntimeNode.preferred_credential_source.trim()
      : "";
  if (!rawSource || rawSource === PUBLIC_INFISICAL_CREDENTIAL_SOURCE) return;
  opts.errors.push(
    deploymentError(
      opts.label,
      `infisical_runtime.preferred_credential_source must be ${PUBLIC_INFISICAL_CREDENTIAL_SOURCE}`,
    ),
  );
}
