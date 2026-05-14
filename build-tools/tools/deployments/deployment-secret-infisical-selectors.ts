#!/usr/bin/env zx-wrapper
import type {
  DeploymentInfisicalRuntimeConfig,
  DeploymentInfisicalSecretMapping,
} from "./deployment-secret-metadata";
import type { DeploymentSecretContractBinding } from "./deployment-sprinkle-ref";

export type DeploymentInfisicalSelector = {
  projectId: string;
  environment: string;
  secretPath: string;
  secretName: string;
};

export type DeploymentInfisicalIdentity = {
  id?: string;
  reference?: string;
};

function normalizeInfisicalSecretPath(value?: string): string {
  const normalized = String(value || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  return normalized ? `/${normalized}` : "/";
}

function joinInfisicalSecretPath(base?: string, prefix?: string): string {
  return normalizeInfisicalSecretPath([base, prefix].filter(Boolean).join("/"));
}

export function deploymentInfisicalSelector(opts: {
  binding: DeploymentSecretContractBinding;
  runtime: DeploymentInfisicalRuntimeConfig;
  mappings?: Record<string, DeploymentInfisicalSecretMapping>;
}): DeploymentInfisicalSelector {
  const mapping = opts.mappings?.[opts.binding.contractId];
  const runtimePath = joinInfisicalSecretPath(
    opts.runtime.secretPath,
    opts.runtime.secretPathPrefix,
  );
  return {
    projectId: opts.runtime.projectId,
    environment: opts.runtime.environment,
    secretPath: mapping?.secretPath
      ? normalizeInfisicalSecretPath(mapping.secretPath)
      : runtimePath,
    secretName: mapping?.secretName || opts.binding.contractId.split("/").pop() || "",
  };
}

export function deploymentInfisicalBackendRef(
  selector: DeploymentInfisicalSelector,
  identity: DeploymentInfisicalIdentity = {},
): string {
  const identityRef = deploymentInfisicalIdentityRef(identity);
  return `${selector.projectId}:${selector.environment}:${selector.secretPath}:${selector.secretName}${identityRef}`;
}

export function deploymentInfisicalSelectorRef(
  selector: DeploymentInfisicalSelector,
  version?: string,
): string {
  const versionSuffix = version ? `@${version}` : "";
  return `${selector.projectId}:${selector.environment}:${selector.secretPath}:${selector.secretName}${versionSuffix}`;
}

export function parseDeploymentInfisicalBackendRef(value: string): {
  selector: DeploymentInfisicalSelector;
  identity: DeploymentInfisicalIdentity;
} {
  const [projectId, environment, secretPath, nameAndIdentity] = value.split(":");
  const [secretName, rawIdentity] = (nameAndIdentity || "").split("#");
  return {
    selector: {
      projectId: projectId || "",
      environment: environment || "",
      secretPath: secretPath || "",
      secretName: secretName || "",
    },
    identity: parseDeploymentInfisicalIdentity(rawIdentity),
  };
}

function deploymentInfisicalIdentityRef(identity: DeploymentInfisicalIdentity): string {
  if (identity.id && !identity.reference) return `#${identity.id}`;
  const params = new URLSearchParams();
  if (identity.id) params.set("id", identity.id);
  if (identity.reference) params.set("reference", identity.reference);
  const serialized = params.toString();
  return serialized ? `#${serialized}` : "";
}

function parseDeploymentInfisicalIdentity(value?: string): DeploymentInfisicalIdentity {
  if (!value) return {};
  if (!value.includes("=")) return { id: value };
  const params = new URLSearchParams(value);
  return {
    ...(params.get("id") ? { id: params.get("id") || undefined } : {}),
    ...(params.get("reference") ? { reference: params.get("reference") || undefined } : {}),
  };
}
