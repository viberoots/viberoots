#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { normalizeTargetLabel } from "../lib/labels";
import { deploymentSecretBackendSelectorErrors } from "./deployment-secret-backend-selector";

const PROVIDER_KEYS = new Set(["aws", "infisical", "supabase", "cloudflare"]);
const PROVIDER_FIELDS: Record<string, Set<string>> = {
  aws: fieldSet([
    "account",
    "accountId",
    "account_id",
    "organizationId",
    "organization_id",
    "region",
    "defaultRegion",
  ]),
  cloudflare: fieldSet([
    "account",
    "accountId",
    "account_id",
    "project",
    "projectName",
    "projectId",
    "id",
    "customDomain",
    "custom_domain",
    "customDomainZoneId",
    "custom_domain_zone_id",
    "zoneId",
    "zone_id",
    "apiTokenRef",
    "tokenRef",
  ]),
  infisical: fieldSet([
    "host",
    "site_url",
    "projectId",
    "project_id",
    "projectName",
    "project_name",
    "projectSlug",
    "project_slug",
    "environment",
    "defaultPath",
    "secret_path",
    "clientIdEnv",
    "machine_identity_client_id_env",
    "clientSecretEnv",
    "machine_identity_client_secret_env",
    "clientIdRef",
    "machine_identity_client_id_ref",
    "clientSecretRef",
    "machine_identity_client_secret_ref",
    "clientIdFileName",
    "machine_identity_client_id_file_name",
    "clientSecretFileName",
    "machine_identity_client_secret_file_name",
    "machineIdentityId",
    "machine_identity_id",
    "machineIdentityName",
    "machine_identity_name",
    "credentialSource",
    "preferred_credential_source",
  ]),
  supabase: fieldSet(["organizationId", "organization_id", "projectRef", "project_ref", "region"]),
};
const APP_FORBIDDEN_KEYS = [
  "deployment_context",
  "secret_backend",
  "secret_backend_profile",
  "infisical_runtime",
  "provider_target",
  "sprinkleref",
  "control_plane",
  "controlPlane",
  "controlPlaneUrl",
  "controlPlaneTokenRef",
];
const SECRET_REF_FIELDS = new Set([
  "apiTokenRef",
  "clientIdRef",
  "clientSecretRef",
  "machine_identity_client_id_ref",
  "machine_identity_client_secret_ref",
  "tokenRef",
]);
const SECRET_VALUE_FIELD_TOKENS = [
  "apitoken",
  "clientsecret",
  "password",
  "privatekey",
  "token",
  "credential",
];

type ContextRecord = Record<string, unknown>;

export function pushAppDeploymentTopologyErrors(nodes: GraphNode[], errors: string[]) {
  for (const node of nodes) {
    if (!isAppNode(node)) continue;
    const label = String(node.name || "");
    for (const key of APP_FORBIDDEN_KEYS) {
      if (node[key] === undefined) continue;
      errors.push(
        deploymentContextError(label, `apps cannot declare deployment resolver topology ${key}`),
      );
    }
  }
}

export function validateDeploymentContext(opts: {
  context: ContextRecord;
  selector: string;
  label: string;
  errors: string[];
}) {
  for (const [key, value] of Object.entries(opts.context)) {
    if (key === "secretBackend") {
      pushSecretBackendErrors(opts, value);
      continue;
    }
    if (key === "controlPlane") {
      if (!stringValue(value)) {
        opts.errors.push(
          deploymentContextError(
            opts.label,
            `deployment_context ${opts.selector}.controlPlane must be a non-empty string`,
          ),
        );
      }
      continue;
    }
    if (!PROVIDER_KEYS.has(key)) {
      opts.errors.push(
        deploymentContextError(
          opts.label,
          `deployment_context ${opts.selector}.${key} is unsupported`,
        ),
      );
      continue;
    }
    validateProviderSection({ ...opts, sectionName: key, value });
  }
}

function pushSecretBackendErrors(
  opts: { selector: string; label: string; errors: string[] },
  value: unknown,
) {
  const secretBackend = stringValue(value);
  if (!secretBackend) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `deployment_context ${opts.selector}.secretBackend must be a non-empty string`,
      ),
    );
    return;
  }
  for (const error of deploymentSecretBackendSelectorErrors({ secretBackend })) {
    opts.errors.push(
      deploymentContextError(opts.label, `deployment_context ${opts.selector}: ${error}`),
    );
  }
}

function validateProviderSection(opts: {
  selector: string;
  label: string;
  errors: string[];
  sectionName: string;
  value: unknown;
}) {
  if (!isRecord(opts.value)) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `deployment_context ${opts.selector}.${opts.sectionName} must be an object`,
      ),
    );
    return;
  }
  for (const [field, value] of Object.entries(opts.value)) {
    pushProviderFieldError({ ...opts, field, value });
  }
}

function pushProviderFieldError(opts: {
  selector: string;
  label: string;
  errors: string[];
  sectionName: string;
  field: string;
  value: unknown;
}) {
  const value = stringValue(opts.value);
  const fieldPath = `deployment_context ${opts.selector}.${opts.sectionName}.${opts.field}`;
  const allowedFields = PROVIDER_FIELDS[opts.sectionName] || new Set<string>();
  if (!allowedFields.has(opts.field)) {
    opts.errors.push(
      deploymentContextError(opts.label, `${fieldPath} is unsupported for ${opts.sectionName}`),
    );
  }
  if (SECRET_REF_FIELDS.has(opts.field) && !value.startsWith("secret://")) {
    opts.errors.push(deploymentContextError(opts.label, `${fieldPath} must be a secret:// ref`));
  } else if (looksSecretField(opts.field) && value && !value.startsWith("secret://")) {
    opts.errors.push(
      deploymentContextError(opts.label, `${fieldPath} must not contain a plaintext secret value`),
    );
  }
}

export function deploymentContextError(label: string, message: string): string {
  return `${normalizeTargetLabel(label)}: ${message}`;
}

function looksSecretField(field: string) {
  if (SECRET_REF_FIELDS.has(field)) return false;
  const normalized = field.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (
    normalized.endsWith("path") ||
    normalized.endsWith("id") ||
    normalized.endsWith("name") ||
    normalized.endsWith("env") ||
    normalized.endsWith("filename")
  ) {
    return false;
  }
  return SECRET_VALUE_FIELD_TOKENS.some((token) => normalized.includes(token));
}

function isAppNode(node: GraphNode) {
  return Array.isArray(node.labels) && node.labels.includes("kind:app");
}

function isRecord(value: unknown): value is ContextRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function fieldSet(fields: string[]) {
  return new Set(fields);
}
