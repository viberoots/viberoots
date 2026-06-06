#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { normalizeDeploymentSecretBackendSelector } from "./deployment-secret-backend-selector";
import { applyContextSecretRefs, selectedContextOverrides } from "./deployment-context-secret-refs";
import {
  deploymentContextError,
  pushAppDeploymentTopologyErrors,
  validateDeploymentContext,
} from "./deployment-context-validation";
import {
  readProjectConfigSync,
  redactedProjectConfigOverrides,
  type ProjectConfig,
  type RedactedProjectConfigOverride,
} from "./project-config";

const CONTEXT_NAME = /^[a-z0-9][a-z0-9-]*$/;

type ContextRecord = Record<string, unknown>;

export function resolveDeploymentContextNodes(nodes: GraphNode[], errors: string[]): GraphNode[] {
  const loaded = readProjectConfigSync();
  pushAppDeploymentTopologyErrors(nodes, errors);
  return nodes.map((node) =>
    resolveDeploymentContextNode({
      node,
      config: loaded.config,
      overrides: redactedProjectConfigOverrides(loaded.overrides),
      errors,
    }),
  );
}

export function resolveDeploymentContextNode(opts: {
  node: GraphNode;
  config: ProjectConfig;
  overrides?: RedactedProjectConfigOverride[];
  errors: string[];
}): GraphNode {
  const rawSelector = opts.node.deployment_context;
  if (!rawSelector) return { ...opts.node };
  const label = String(opts.node.name || "");
  if (typeof rawSelector !== "string") {
    opts.errors.push(deploymentContextError(label, "deployment_context must be a selector string"));
    return { ...opts.node };
  }
  const selector = rawSelector.trim();
  if (!CONTEXT_NAME.test(selector)) {
    opts.errors.push(
      deploymentContextError(label, "deployment_context must be backend-local kebab-case"),
    );
    return { ...opts.node };
  }
  const context = contextByName(opts.config, selector);
  if (!context) {
    opts.errors.push(
      deploymentContextError(
        label,
        `unknown deployment_context "${selector}" in projects/config/shared.json or projects/config/local.json`,
      ),
    );
    return { ...opts.node };
  }
  const next = { ...opts.node };
  const localOverrides = selectedContextOverrides(opts.overrides || [], selector);
  if (process.env.VBR_DISALLOW_LOCAL_OVERRIDES === "1" && localOverrides.length > 0) {
    opts.errors.push(
      deploymentContextError(
        label,
        `local project config overrides are disabled: ${localOverrides.map((entry) => entry.path).join(", ")}`,
      ),
    );
  }
  validateDeploymentContext({ context, selector, label, errors: opts.errors });
  applySecretBackendDefault({ node: next, context, label, errors: opts.errors });
  applyProviderDefaults({ node: next, context, label, errors: opts.errors });
  applyContextSecretRefs({ node: next, context, localOverrides });
  return next;
}

function contextByName(config: ProjectConfig, selector: string): ContextRecord | undefined {
  const contexts = config.deploymentContexts;
  if (!isRecord(contexts)) return undefined;
  const context = contexts[selector];
  return isRecord(context) ? context : undefined;
}

function applySecretBackendDefault(opts: {
  node: GraphNode;
  context: ContextRecord;
  label: string;
  errors: string[];
}) {
  const contextBackend = stringValue(opts.context.secretBackend);
  if (!contextBackend) return;
  const explicit = stringValue(opts.node.secret_backend);
  if (!explicit) {
    opts.node.secret_backend = contextBackend;
    return;
  }
  const left = normalizeDeploymentSecretBackendSelector({ secretBackend: explicit });
  const right = normalizeDeploymentSecretBackendSelector({ secretBackend: contextBackend });
  if (left.backend !== right.backend || left.profile !== right.profile) {
    opts.errors.push(
      deploymentContextError(
        opts.label,
        `secret_backend ${explicit} disagrees with deployment_context secretBackend ${contextBackend}`,
      ),
    );
  }
}

function applyProviderDefaults(opts: {
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
    environment: ["environment"],
    secret_path: ["secret_path", "defaultPath"],
    machine_identity_client_id_ref: ["machine_identity_client_id_ref", "clientIdRef"],
    machine_identity_client_secret_ref: ["machine_identity_client_secret_ref", "clientSecretRef"],
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
