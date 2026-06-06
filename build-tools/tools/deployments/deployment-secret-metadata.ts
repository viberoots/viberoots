#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { readString } from "./deployment-graph-readers";
import { deploymentError } from "./contract-extract-shared";
import { pushInfisicalCredentialSourceErrors } from "./deployment-infisical-credential-source-validation";
import { pushInfisicalUniversalAuthEnvErrors } from "./deployment-infisical-env-validation";
import { deploymentSecretFixturePath } from "./deployment-secret-fixture";
import { pushForbiddenInfisicalRuntimeKeyErrors } from "./deployment-secret-profile";
import {
  deploymentSecretBackendSelectorErrors,
  normalizeDeploymentSecretBackendSelector,
} from "./deployment-secret-backend-selector";
import type { DeploymentRequirement } from "./deployment-requirements";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";
import {
  readDeploymentContextMetadata,
  type DeploymentContextMetadata,
} from "./deployment-context-metadata";
import {
  readInfisicalRuntime,
  type DeploymentInfisicalRuntimeConfig,
} from "./deployment-infisical-runtime";

export type { DeploymentInfisicalRuntimeConfig } from "./deployment-infisical-runtime";

export type DeploymentInfisicalSecretMapping = {
  secretName: string;
  secretPath: string;
  approvedPlaceholder?: boolean;
  placeholderReason?: string;
};

export type DeploymentSecretMetadata = {
  deploymentContext?: DeploymentContextMetadata;
  secretBackend?: DeploymentSecretBackendKind;
  secretBackendProfile?: string;
  infisicalRuntime?: DeploymentInfisicalRuntimeConfig;
  infisicalSecretMappings?: Record<string, DeploymentInfisicalSecretMapping>;
};

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
  const secretBackend = readString(node, "secret_backend");
  const secretBackendProfile = readString(node, "secret_backend_profile");
  const { backend, profile } = normalizeDeploymentSecretBackendSelector({
    secretBackend,
    secretBackendProfile,
  });
  const rawRuntimeNode = readRawRecord(node, "infisical_runtime");
  const runtime = readInfisicalRuntime(node);
  const mappings = readInfisicalMappings(node);
  const deploymentContext = readDeploymentContextMetadata(node);
  validateDeploymentSecretMetadata({
    label,
    requirements,
    errors,
    backend,
    profile,
    rawRuntimeNode,
    runtime,
    mappings,
    selectorErrors: deploymentSecretBackendSelectorErrors({ secretBackend, secretBackendProfile }),
  });
  return {
    ...(deploymentContext ? { deploymentContext } : {}),
    secretBackend: backend,
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
  runtime?: DeploymentInfisicalRuntimeConfig;
  mappings?: Record<string, DeploymentInfisicalSecretMapping>;
  selectorErrors: string[];
}) {
  for (const error of opts.selectorErrors) {
    opts.errors.push(deploymentError(opts.label, error));
  }
  pushForbiddenInfisicalRuntimeKeyErrors({
    label: opts.label,
    runtime: opts.rawRuntimeNode,
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
  pushInfisicalCredentialSourceErrors(opts);
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
