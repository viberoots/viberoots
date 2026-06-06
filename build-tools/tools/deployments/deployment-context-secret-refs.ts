#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import type { RedactedProjectConfigOverride } from "./project-config";

type ContextRecord = Record<string, unknown>;
type ContextSecretRefRoute = {
  provider: string;
  field: string;
  ref: string;
  route: "bootstrap" | "secret_backend";
};

export function applyContextSecretRefs(opts: {
  node: GraphNode;
  context: ContextRecord;
  localOverrides: RedactedProjectConfigOverride[];
}) {
  const secretRefs = contextSecretRefs(opts.context);
  opts.node.deployment_context_metadata = {
    name: stringValue(opts.node.deployment_context),
    ...(opts.localOverrides.length ? { localOverrides: opts.localOverrides } : {}),
    ...(secretRefs.length ? { secretRefs } : {}),
  };
  const cloudflareToken = secretRefs.find(
    (entry) => entry.provider === "cloudflare" && entry.field === "apiTokenRef",
  );
  if (cloudflareToken) appendCloudflareTokenRequirement(opts.node, cloudflareToken.ref);
}

export function contextSecretRefs(context: ContextRecord): ContextSecretRefRoute[] {
  const refs: ContextSecretRefRoute[] = [];
  for (const [provider, value] of Object.entries(context)) {
    if (!isRecord(value)) continue;
    for (const [field, raw] of Object.entries(value)) {
      const ref = stringValue(raw);
      if (!ref.startsWith("secret://")) continue;
      refs.push({ provider, field, ref, route: secretRefRoute(provider, field) });
    }
  }
  return refs;
}

export function selectedContextOverrides(
  overrides: RedactedProjectConfigOverride[],
  selector: string,
): RedactedProjectConfigOverride[] {
  return overrides.filter((entry) => entry.path.startsWith(`deploymentContexts.${selector}.`));
}

function appendCloudflareTokenRequirement(node: GraphNode, contractId: string) {
  const existing = Array.isArray(node.secret_requirements) ? node.secret_requirements : [];
  const next = [...existing];
  for (const step of ["publish", "preview_cleanup"]) {
    if (
      existing.some(
        (entry) =>
          isRecord(entry) &&
          entry.name === "cloudflare_api_token" &&
          entry.step === step &&
          entry.contract_id,
      )
    ) {
      continue;
    }
    next.push({
      name: "cloudflare_api_token",
      contract_id: contractId,
      required: "true",
      source: "deployment_context",
      notes: "context-owned Cloudflare API token ref routed through selected secret_backend",
      step,
    });
  }
  node.secret_requirements = next;
}

function secretRefRoute(provider: string, field: string) {
  if (provider === "infisical" && (field === "clientIdRef" || field === "clientSecretRef")) {
    return "bootstrap";
  }
  return "secret_backend";
}

function isRecord(value: unknown): value is ContextRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
