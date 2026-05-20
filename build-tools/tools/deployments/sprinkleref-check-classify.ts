#!/usr/bin/env zx-wrapper
import { createSprinkleRefStore } from "./sprinkleref-store";
import type { SprinkleRefCheckEntry } from "./sprinkleref-check-types";

export type CheckableRef = Pick<
  SprinkleRefCheckEntry,
  | "ref"
  | "scheme"
  | "scope"
  | "locations"
  | "requiredBy"
  | "source"
  | "backendEnvironment"
  | "deploymentFamily"
>;

export function consolidateRefs(refs: CheckableRef[]): CheckableRef[] {
  const entries = new Map<string, CheckableRef>();
  for (const entry of refs) {
    const key = JSON.stringify([
      entry.ref,
      entry.scope,
      entry.source || "",
      entry.backendEnvironment || "",
      entry.deploymentFamily || "",
    ]);
    const current = entries.get(key);
    if (!current) {
      entries.set(key, { ...entry });
      continue;
    }
    current.locations = [...new Set([...current.locations, ...entry.locations])];
    current.requiredBy = [...new Set([...current.requiredBy, ...entry.requiredBy])];
  }
  return [...entries.values()];
}

export function backendForEntry(
  backend: Parameters<typeof createSprinkleRefStore>[0],
  entry: Pick<SprinkleRefCheckEntry, "backendEnvironment">,
) {
  if (backend.backend !== "infisical" || !entry.backendEnvironment) return backend;
  return { ...backend, defaultEnvironment: entry.backendEnvironment };
}

export function managedBootstrapOutput(ref: string):
  | {
      by: string;
      family: string;
      reason: string;
    }
  | undefined {
  const match = ref.match(
    /^secret:\/\/deployments\/([^/]+)\/(dev|staging|prod)\/infisical-client-(id|secret)$/,
  );
  if (!match) return undefined;
  return {
    by: "infisical deployment bootstrap",
    family: match[1],
    reason: "materialized by deployment bootstrap",
  };
}
