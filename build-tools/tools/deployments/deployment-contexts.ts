#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { normalizeDeploymentSecretBackendSelector } from "./deployment-secret-backend-selector";
import { applyContextSecretRefs, selectedContextOverrides } from "./deployment-context-secret-refs";
import {
  resolveContextControlPlane,
  validateControlPlaneProfiles,
} from "./deployment-control-plane-profile";
import { applyProviderDefaults } from "./deployment-context-provider-defaults";
import { KUBERNETES_PROVIDER, OPENTOFU_PROVIDER } from "./deployment-provider-targets";
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
const DEFAULT_LOCAL_ONLY_PROVIDERS = new Set([KUBERNETES_PROVIDER, OPENTOFU_PROVIDER]);

type ContextRecord = Record<string, unknown>;

export function resolveDeploymentContextNodes(
  nodes: GraphNode[],
  errors: string[],
  workspaceRoot = process.cwd(),
): GraphNode[] {
  const loaded = readProjectConfigSync(workspaceRoot);
  pushAppDeploymentTopologyErrors(nodes, errors);
  validateControlPlaneProfiles({
    config: loaded.config,
    label: "projects/config",
    errors,
  });
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
  const controlPlane = resolveContextControlPlane({
    config: opts.config,
    selector,
    context,
    label,
    errors: opts.errors,
  });
  const localOverrides = selectedContextOverrides(
    opts.overrides || [],
    selector,
    stringValue(context.controlPlane),
  );
  if (process.env.VBR_DISALLOW_LOCAL_OVERRIDES === "1" && localOverrides.length > 0) {
    opts.errors.push(
      deploymentContextError(
        label,
        `local project config overrides are disabled: ${localOverrides.map((entry) => entry.path).join(", ")}`,
      ),
    );
  }
  validateDeploymentContext({ context, selector, label, errors: opts.errors });
  validateProtectedSharedContextControlPlane({
    node: opts.node,
    selector,
    context,
    label,
    errors: opts.errors,
  });
  applySecretBackendDefault({ node: next, context, label, errors: opts.errors });
  applyProviderDefaults({ node: next, context, label, errors: opts.errors });
  if (controlPlane) next.control_plane = controlPlane.graphMetadata;
  applyContextSecretRefs({ node: next, context, localOverrides, controlPlane });
  return next;
}

function validateProtectedSharedContextControlPlane(opts: {
  node: GraphNode;
  selector: string;
  context: ContextRecord;
  label: string;
  errors: string[];
}) {
  if (!requiresContextControlPlane(opts.node)) return;
  if (stringValue(opts.context.controlPlane)) return;
  opts.errors.push(
    deploymentContextError(
      opts.label,
      `protected/shared deployment_context ${opts.selector} must select a valid controlPlane`,
    ),
  );
}

function requiresContextControlPlane(node: GraphNode) {
  const protectionClass = stringValue(node.protection_class);
  if (protectionClass) return protectionClass !== "local_only";
  return !DEFAULT_LOCAL_ONLY_PROVIDERS.has(stringValue(node.provider));
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

function isRecord(value: unknown): value is ContextRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
