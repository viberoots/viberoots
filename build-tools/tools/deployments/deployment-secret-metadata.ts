#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { readString, readStringRecord } from "./deployment-graph-readers";
import { deploymentError } from "./contract-extract-shared";
import { pushInfisicalUniversalAuthEnvErrors } from "./deployment-infisical-env-validation";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import {
  defaultDeploymentSecretBackendProfile,
  isDeploymentSecretBackendProfile,
  pushForbiddenInfisicalRuntimeKeyErrors,
} from "./deployment-secret-profile";
import type { DeploymentRequirement } from "./deployment-requirements";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";

export type DeploymentInfisicalRuntimeConfig = {
  siteUrl: string;
  projectId: string;
  environment: string;
  secretPath?: string;
  secretPathPrefix?: string;
  machineIdentityClientIdEnv?: string;
  machineIdentityClientSecretEnv?: string;
  machineIdentityClientIdFileName?: string;
  machineIdentityClientSecretFileName?: string;
  machineIdentityId?: string;
  preferredCredentialSource?: "machine_identity_universal_auth";
  accessTokenTtlSeconds?: string;
  accessTokenMaxUses?: string;
};

export type DeploymentInfisicalSecretMapping = {
  secretName: string;
  secretPath: string;
  approvedPlaceholder?: boolean;
  placeholderReason?: string;
};

export type DeploymentSecretMetadata = {
  secretBackend?: DeploymentSecretBackendKind;
  secretBackendProfile?: string;
  infisicalRuntime?: DeploymentInfisicalRuntimeConfig;
  infisicalSecretMappings?: Record<string, DeploymentInfisicalSecretMapping>;
};

const SUPPORTED_BACKENDS = new Set<DeploymentSecretBackendKind>(["vault", "infisical"]);
function readStringRecordMap(node: GraphNode, key: string): Record<string, Record<string, string>> {
  const value = node[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, Record<string, unknown>] => {
        const [, entryValue] = entry;
        return !!entryValue && typeof entryValue === "object" && !Array.isArray(entryValue);
      })
      .map(([entryKey, entryValue]) => [entryKey.trim(), stringRecord(entryValue)])
      .filter(([entryKey]) => entryKey !== ""),
  );
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([entryKey, entryValue]) => [entryKey.trim(), entryValue.trim()])
      .filter(([entryKey, entryValue]) => entryKey !== "" && entryValue !== ""),
  );
}

function readRawRecord(node: GraphNode, key: string): Record<string, unknown> {
  const value = node[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readInfisicalRuntime(node: GraphNode): DeploymentInfisicalRuntimeConfig | undefined {
  const runtime = readStringRecord(node, "infisical_runtime");
  if (Object.keys(runtime).length === 0) return undefined;
  const credentialSource =
    runtime.preferred_credential_source === "infisical_machine_identity_universal_auth"
      ? "machine_identity_universal_auth"
      : runtime.preferred_credential_source;
  return {
    siteUrl: runtime.site_url || "",
    projectId: runtime.project_id || "",
    environment: runtime.environment || "",
    ...(runtime.secret_path ? { secretPath: runtime.secret_path } : {}),
    ...(runtime.secret_path_prefix ? { secretPathPrefix: runtime.secret_path_prefix } : {}),
    ...(runtime.machine_identity_client_id_env
      ? { machineIdentityClientIdEnv: runtime.machine_identity_client_id_env }
      : {}),
    ...(runtime.machine_identity_client_secret_env
      ? { machineIdentityClientSecretEnv: runtime.machine_identity_client_secret_env }
      : {}),
    ...(runtime.machine_identity_client_id_file_name
      ? { machineIdentityClientIdFileName: runtime.machine_identity_client_id_file_name }
      : {}),
    ...(runtime.machine_identity_client_secret_file_name
      ? { machineIdentityClientSecretFileName: runtime.machine_identity_client_secret_file_name }
      : {}),
    ...(runtime.machine_identity_id ? { machineIdentityId: runtime.machine_identity_id } : {}),
    ...(credentialSource ? { preferredCredentialSource: credentialSource } : {}),
    ...(runtime.access_token_ttl_seconds
      ? { accessTokenTtlSeconds: runtime.access_token_ttl_seconds }
      : {}),
    ...(runtime.access_token_max_uses ? { accessTokenMaxUses: runtime.access_token_max_uses } : {}),
  };
}

function readInfisicalMappings(
  node: GraphNode,
): Record<string, DeploymentInfisicalSecretMapping> | undefined {
  const mappings = readStringRecordMap(node, "infisical_secret_mappings");
  if (Object.keys(mappings).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(mappings).map(([contractId, mapping]) => [
      contractId,
      {
        secretName: mapping.secret_name || "",
        secretPath: mapping.secret_path || "",
        ...(mapping.approved_placeholder === "true" ? { approvedPlaceholder: true } : {}),
        ...(mapping.placeholder_reason ? { placeholderReason: mapping.placeholder_reason } : {}),
      },
    ]),
  );
}

export function deploymentSecretMetadata(
  node: GraphNode,
  label: string,
  requirements: DeploymentRequirement[],
  errors: string[],
): DeploymentSecretMetadata {
  const backend = (readString(node, "secret_backend") || "vault") as DeploymentSecretBackendKind;
  const profile =
    readString(node, "secret_backend_profile") || defaultDeploymentSecretBackendProfile(backend);
  const rawRuntimeNode = readRawRecord(node, "infisical_runtime");
  const rawRuntime = readStringRecord(node, "infisical_runtime");
  const runtime = readInfisicalRuntime(node);
  const mappings = readInfisicalMappings(node);
  validateDeploymentSecretMetadata({
    label,
    requirements,
    errors,
    backend,
    profile,
    rawRuntimeNode,
    rawRuntime,
    runtime,
    mappings,
  });
  return {
    secretBackend: SUPPORTED_BACKENDS.has(backend) ? backend : "vault",
    secretBackendProfile: profile,
    ...(runtime ? { infisicalRuntime: runtime } : {}),
    ...(mappings ? { infisicalSecretMappings: mappings } : {}),
  };
}

function validateDeploymentSecretMetadata(opts: {
  label: string;
  requirements: DeploymentRequirement[];
  errors: string[];
  backend: DeploymentSecretBackendKind;
  profile: string;
  rawRuntimeNode: Record<string, unknown>;
  rawRuntime: Record<string, string>;
  runtime?: DeploymentInfisicalRuntimeConfig;
  mappings?: Record<string, DeploymentInfisicalSecretMapping>;
}) {
  if (!SUPPORTED_BACKENDS.has(opts.backend)) {
    opts.errors.push(deploymentError(opts.label, `unsupported secret_backend "${opts.backend}"`));
  }
  if (!opts.profile || !isDeploymentSecretBackendProfile(opts.profile)) {
    opts.errors.push(deploymentError(opts.label, "secret_backend_profile must be kebab-case"));
  }
  pushForbiddenInfisicalRuntimeKeyErrors({
    label: opts.label,
    runtime: opts.rawRuntime,
    errors: opts.errors,
  });
  validateInfisicalRuntime(opts);
  validateInfisicalMappings(opts);
}

function validateInfisicalRuntime(opts: {
  label: string;
  requirements: DeploymentRequirement[];
  errors: string[];
  backend: DeploymentSecretBackendKind;
  rawRuntimeNode: Record<string, unknown>;
  rawRuntime: Record<string, string>;
  runtime?: DeploymentInfisicalRuntimeConfig;
}) {
  if (opts.backend !== "infisical" || opts.requirements.length === 0) return;
  if (deploymentSecretFixturePath()) return;
  const runtime = opts.runtime;
  for (const [field, value] of [
    ["site_url", runtime?.siteUrl],
    ["project_id", runtime?.projectId],
    ["environment", runtime?.environment],
  ] as const) {
    if (!value)
      opts.errors.push(deploymentError(opts.label, `infisical_runtime.${field} is required`));
  }
  if (runtime?.preferredCredentialSource !== "machine_identity_universal_auth") {
    opts.errors.push(
      deploymentError(
        opts.label,
        "infisical_runtime.preferred_credential_source must be infisical_machine_identity_universal_auth",
      ),
    );
  }
  pushInfisicalUniversalAuthEnvErrors({
    label: opts.label,
    errors: opts.errors,
    rawRuntimeNode: opts.rawRuntimeNode,
  });
}

function validateInfisicalMappings(opts: {
  label: string;
  requirements: DeploymentRequirement[];
  errors: string[];
  mappings?: Record<string, DeploymentInfisicalSecretMapping>;
}) {
  const contractIds = new Set(opts.requirements.map((requirement) => requirement.contractId));
  for (const [contractId, mapping] of Object.entries(opts.mappings || {})) {
    if (!contractIds.has(contractId)) {
      opts.errors.push(
        deploymentError(opts.label, `infisical_secret_mappings has stale key ${contractId}`),
      );
    }
    if (!mapping.secretName) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `infisical_secret_mappings.${contractId}.secret_name is required`,
        ),
      );
    }
    if (!mapping.secretPath || !mapping.secretPath.startsWith("/")) {
      opts.errors.push(
        deploymentError(
          opts.label,
          `infisical_secret_mappings.${contractId}.secret_path must start with /`,
        ),
      );
    }
  }
}
