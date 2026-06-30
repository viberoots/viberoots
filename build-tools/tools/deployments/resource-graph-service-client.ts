#!/usr/bin/env zx-wrapper
import type {
  DeploymentResourceInventoryEntry,
  DeploymentRuntimeInventorySources,
  ServiceClientSelectionRecord,
} from "./resource-graph-types";
import type { NixosSharedHostResolvedServiceClient } from "./nixos-shared-host-service-client-config";

export function collectServiceClientSelectionResources(
  out: DeploymentResourceInventoryEntry[],
  errors: string[],
  sources: DeploymentRuntimeInventorySources,
) {
  for (const selection of sources.serviceClientSelections || []) {
    if (!selection.id || !selection.source || !selection.status) {
      errors.push("ServiceClientProfile selection is missing id, source, or status");
      continue;
    }
    if (selection.status === "resolved" && !selection.controlPlaneUrl) {
      errors.push(`ServiceClientProfile ${selection.id}: resolved selection missing URL`);
      continue;
    }
    if (selection.status === "rejected" && !selection.diagnostic) {
      errors.push(`ServiceClientProfile ${selection.id}: rejected selection missing diagnostic`);
      continue;
    }
    out.push({
      kind: "ServiceClientProfile",
      id: selection.id,
      authority: "observed_runtime",
      source: { class: "runtime" },
      ...(selection.refs ? { refs: selection.refs } : {}),
      facts: definedFacts({
        source: selection.source,
        status: selection.status,
        controlPlaneUrl: selection.controlPlaneUrl,
        controlPlaneName: selection.controlPlaneName,
        controlPlaneTokenRef: selection.controlPlaneTokenRef,
        profileName: selection.profileName,
        profileRoot: selection.profileRoot,
        tokenEnv: selection.tokenEnv,
        defaultedFromLanePolicy: selection.defaultedFromLanePolicy,
        diagnostic: selection.diagnostic,
      }),
    });
  }
}

export function resolvedServiceClientSelectionRecord(opts: {
  id: string;
  source: ServiceClientSelectionRecord["source"];
  client: NixosSharedHostResolvedServiceClient & { selectedSource?: string };
  profileName?: string;
  profileRoot?: string;
  tokenEnv?: string;
  defaultedFromLanePolicy?: boolean;
  refs?: string[];
}): ServiceClientSelectionRecord {
  return {
    id: opts.id,
    source: opts.source,
    status: "resolved",
    controlPlaneUrl: opts.client.controlPlaneUrl,
    controlPlaneName: opts.client.controlPlaneName,
    controlPlaneTokenRef: opts.client.controlPlaneTokenRef,
    profileName: opts.profileName,
    profileRoot: opts.profileRoot,
    tokenEnv: opts.tokenEnv || opts.client.plan.controlPlaneTokenEnv,
    defaultedFromLanePolicy: opts.defaultedFromLanePolicy,
    refs: opts.refs,
  };
}

export function rejectedServiceClientSelectionRecord(opts: {
  id: string;
  source: ServiceClientSelectionRecord["source"];
  error: unknown;
  refs?: string[];
}): ServiceClientSelectionRecord {
  return {
    id: opts.id,
    source: opts.source,
    status: "rejected",
    diagnostic: opts.error instanceof Error ? opts.error.message : String(opts.error),
    refs: opts.refs,
  };
}

function definedFacts(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}
