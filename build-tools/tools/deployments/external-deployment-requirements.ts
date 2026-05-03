#!/usr/bin/env zx-wrapper
import type { DeploymentRequirement } from "./deployment-requirements.ts";

export type ExternalDeploymentRequirementProfile =
  | "workos_authkit"
  | "supabase"
  | "ragie"
  | "source_access"
  | "console_web_base_url"
  | "cloudflare_provider"
  | "vercel_provider"
  | "container_runtime_provider"
  | "dns_provider"
  | "opentofu_provider";

type ExpectedRequirement = {
  field: "secret_requirements" | "runtime_config_requirements";
  name: string;
  step: DeploymentRequirement["step"];
  contractPrefix: string;
  targetScope: string;
};

const PROFILES: Record<ExternalDeploymentRequirementProfile, ExpectedRequirement[]> = {
  workos_authkit: [
    runtime("workos_client_id", "publish", "config://deployments/workos/client_id"),
    runtime("workos_redirect_uri", "publish", "config://deployments/workos/redirect_uri"),
    secret("workos_client_secret", "publish", "secret://deployments/workos/client_secret"),
  ],
  supabase: [
    runtime("supabase_public_url", "publish", "config://deployments/supabase/public_url"),
    secret(
      "supabase_service_role_key",
      "publish",
      "secret://deployments/supabase/service_role_key",
    ),
  ],
  ragie: [secret("ragie_api_key", "publish", "secret://deployments/ragie/api_key")],
  source_access: [
    secret("source_access_hmac_key", "publish", "secret://deployments/source-access/hmac_key"),
  ],
  console_web_base_url: [
    runtime("console_to_web_base_url", "publish", "config://deployments/console/web_base_url"),
  ],
  cloudflare_provider: [
    secret(
      "cloudflare_api_token",
      "provision",
      "secret://deployments/pleomino/cloudflare_api_token",
    ),
    secret("cloudflare_api_token", "publish", "secret://deployments/pleomino/cloudflare_api_token"),
    secret(
      "cloudflare_api_token",
      "preview_cleanup",
      "secret://deployments/pleomino/cloudflare_api_token",
    ),
  ],
  vercel_provider: [secret("vercel_api_token", "publish", "secret://deployments/vercel/api_token")],
  container_runtime_provider: [
    secret("container_runtime_token", "publish", "secret://deployments/container-runtime/token"),
  ],
  dns_provider: [secret("dns_provider_token", "provision", "secret://deployments/dns/token")],
  opentofu_provider: [
    secret("opentofu_provider_credentials", "provision", "secret://deployments/opentofu/provider"),
  ],
};

export function externalRequirementProfiles() {
  return Object.keys(PROFILES).sort() as ExternalDeploymentRequirementProfile[];
}

export function isExternalRequirementProfile(
  profile: string,
): profile is ExternalDeploymentRequirementProfile {
  return Object.prototype.hasOwnProperty.call(PROFILES, profile);
}

export function externalRequirementProfileRequirements(
  profile: ExternalDeploymentRequirementProfile,
): ExpectedRequirement[] {
  return [...PROFILES[profile]];
}

export function validateExternalRequirementProfiles(opts: {
  label: string;
  profiles: ExternalDeploymentRequirementProfile[];
  secretRequirements: DeploymentRequirement[];
  runtimeConfigRequirements: DeploymentRequirement[];
}): string[] {
  const errors: string[] = [];
  const byField = {
    secret_requirements: opts.secretRequirements,
    runtime_config_requirements: opts.runtimeConfigRequirements,
  };
  errors.push(
    ...duplicateRequirementErrors(opts.label, "secret_requirements", opts.secretRequirements),
    ...duplicateRequirementErrors(
      opts.label,
      "runtime_config_requirements",
      opts.runtimeConfigRequirements,
    ),
  );
  for (const profile of opts.profiles) {
    for (const expected of PROFILES[profile]) {
      const sameName = byField[expected.field].filter((entry) => entry.name === expected.name);
      const matches = sameName.filter((entry) => entry.step === expected.step);
      const match = matches[0];
      if (!match) {
        if (sameName[0]) {
          pushRequirementMismatch(errors, opts.label, profile, expected, sameName[0]);
          continue;
        }
        errors.push(`${opts.label}: ${profile} missing ${expected.field} ${expected.name}`);
        continue;
      }
      if (matches.length > 1) continue;
      pushRequirementMismatch(errors, opts.label, profile, expected, match);
    }
  }
  return errors;
}

export function ambientProviderEnvBypassErrors(opts: {
  label: string;
  env: Record<string, string | undefined>;
  secretRequirements: DeploymentRequirement[];
  profiles?: ExternalDeploymentRequirementProfile[];
}): string[] {
  const secretNames = new Set(opts.secretRequirements.map((entry) => envName(entry.name)));
  const blockedPrefixes = new Set(
    (opts.profiles || externalRequirementProfiles()).flatMap((profile) =>
      profile === "vercel_provider" ? ["VERCEL_"] : profile === "ragie" ? ["RAGIE_"] : [],
    ),
  );
  return Object.keys(opts.env)
    .filter(
      (key) =>
        secretNames.has(key) ||
        Array.from(blockedPrefixes).some((prefix) => key.startsWith(prefix)),
    )
    .map((key) => `${opts.label}: ambient provider env ${key} cannot satisfy secret_requirements`);
}

function pushRequirementMismatch(
  errors: string[],
  label: string,
  profile: string,
  expected: ExpectedRequirement,
  actual: DeploymentRequirement,
) {
  if (actual.step !== expected.step) {
    errors.push(`${label}: ${profile} ${actual.name} must use step ${expected.step}`);
  }
  if (!actual.contractId.startsWith(expected.contractPrefix)) {
    errors.push(`${label}: ${profile} ${actual.name} has wrong contract scope`);
  }
  if (actual.source && actual.source !== expected.targetScope) {
    errors.push(`${label}: ${profile} ${actual.name} must use ${expected.targetScope}`);
  }
}

function duplicateRequirementErrors(
  label: string,
  field: "secret_requirements" | "runtime_config_requirements",
  requirements: DeploymentRequirement[],
): string[] {
  const counts = new Map<string, number>();
  for (const requirement of requirements) {
    const key = `${requirement.name}:${requirement.step}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([key, count]) => key.split(":")[0] && count > 1)
    .map(([key]) => `${label}: duplicate ${field} declaration ${key.split(":")[0]}`);
}

function secret(
  name: string,
  step: DeploymentRequirement["step"],
  contractPrefix: string,
): ExpectedRequirement {
  return {
    field: "secret_requirements",
    name,
    step,
    contractPrefix,
    targetScope: "secret_runtime",
  };
}

function runtime(
  name: string,
  step: DeploymentRequirement["step"],
  contractPrefix: string,
): ExpectedRequirement {
  return {
    field: "runtime_config_requirements",
    name,
    step,
    contractPrefix,
    targetScope: "runtime_config",
  };
}

function envName(name: string): string {
  return name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_");
}
