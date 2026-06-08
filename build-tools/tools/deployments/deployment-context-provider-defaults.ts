#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { deploymentContextError } from "./deployment-context-validation";

type ContextRecord = Record<string, unknown>;

export function applyProviderDefaults(opts: {
  node: GraphNode;
  context: ContextRecord;
  label: string;
  errors: string[];
}) {
  const section = providerSection(opts.node.provider, opts.context);
  if (section) mergeRecordField(opts, "provider_target", providerTargetDefaults(section));
  if (String(opts.node.provider || "") === "s3-static" && isRecord(opts.context.aws)) {
    mergeRecordField(opts, "provider_target", awsProviderTargetDefaults(opts.context.aws));
  }
  const infisical = isRecord(opts.context.infisical) ? opts.context.infisical : undefined;
  if (infisical) mergeRecordField(opts, "infisical_runtime", infisicalRuntimeDefaults(infisical));
}

function providerSection(provider: unknown, context: ContextRecord) {
  const key = String(provider || "").startsWith("cloudflare")
    ? "cloudflare"
    : String(provider || "");
  return isRecord(context[key]) ? context[key] : undefined;
}

function mergeRecordField(
  opts: { node: GraphNode; label: string; errors: string[] },
  fieldName: string,
  defaults: Record<string, string>,
) {
  const existing = isRecord(opts.node[fieldName])
    ? (opts.node[fieldName] as Record<string, unknown>)
    : {};
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing))
    if (typeof value === "string") merged[key] = value;
  for (const [key, value] of Object.entries(defaults)) {
    if (!value) continue;
    if (merged[key] && merged[key] !== value) {
      opts.errors.push(
        deploymentContextError(
          opts.label,
          `${fieldName}.${key} ${merged[key]} disagrees with deployment_context ${value}`,
        ),
      );
      continue;
    }
    merged[key] = value;
  }
  opts.node[fieldName] = merged;
}

function providerTargetDefaults(section: ContextRecord) {
  return pickAliases(section, {
    account: ["account", "accountId"],
    account_id: ["account_id", "accountId"],
    organization_id: ["organization_id", "organizationId"],
    project: ["project", "projectName"],
    id: ["id", "projectId"],
    custom_domain: ["custom_domain", "customDomain"],
    custom_domain_zone_id: ["custom_domain_zone_id", "customDomainZoneId", "zoneId"],
    region: ["region", "defaultRegion"],
    zone_id: ["zone_id", "zoneId"],
  });
}

function awsProviderTargetDefaults(section: ContextRecord) {
  return pickAliases(section, {
    account: ["account", "accountId"],
    account_id: ["account_id", "accountId"],
    organization_id: ["organization_id", "organizationId"],
    region: ["region", "defaultRegion"],
  });
}

function infisicalRuntimeDefaults(section: ContextRecord) {
  const picked = pickAliases(section, {
    site_url: ["site_url", "host"],
    project_id: ["project_id", "projectId"],
    project_name: ["project_name", "projectName"],
    project_slug: ["project_slug", "projectSlug"],
    environment: ["environment"],
    secret_path: ["secret_path", "defaultPath"],
    machine_identity_client_id_env: ["machine_identity_client_id_env", "clientIdEnv"],
    machine_identity_client_secret_env: ["machine_identity_client_secret_env", "clientSecretEnv"],
    machine_identity_client_id_ref: ["machine_identity_client_id_ref", "clientIdRef"],
    machine_identity_client_secret_ref: ["machine_identity_client_secret_ref", "clientSecretRef"],
    machine_identity_client_id_file_name: [
      "machine_identity_client_id_file_name",
      "clientIdFileName",
    ],
    machine_identity_client_secret_file_name: [
      "machine_identity_client_secret_file_name",
      "clientSecretFileName",
    ],
    machine_identity_id: ["machine_identity_id", "machineIdentityId"],
    preferred_credential_source: ["preferred_credential_source", "credentialSource"],
  });
  if (
    !picked.preferred_credential_source &&
    picked.machine_identity_client_id_ref &&
    picked.machine_identity_client_secret_ref
  ) {
    picked.preferred_credential_source = "infisical_machine_identity_universal_auth";
  }
  return picked;
}

function pickAliases(section: ContextRecord, aliases: Record<string, string[]>) {
  const picked: Record<string, string> = {};
  for (const [field, keys] of Object.entries(aliases)) {
    picked[field] = keys.map((key) => stringValue(section[key])).find(Boolean) || "";
  }
  return picked;
}

function isRecord(value: unknown): value is ContextRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
