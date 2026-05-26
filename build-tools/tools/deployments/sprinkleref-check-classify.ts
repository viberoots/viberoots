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
  | "backendHost"
  | "backendProjectId"
  | "backendProjectName"
  | "backendSecretPath"
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
      entry.backendHost || "",
      entry.backendProjectId || "",
      entry.backendProjectName || "",
      entry.backendSecretPath || "",
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
  entry: Pick<
    SprinkleRefCheckEntry,
    | "backendEnvironment"
    | "backendHost"
    | "backendProjectId"
    | "backendProjectName"
    | "backendSecretPath"
  >,
) {
  if (backend.backend !== "infisical") return backend;
  return {
    ...backend,
    ...(entry.backendHost ? { host: entry.backendHost } : {}),
    ...(entry.backendProjectId
      ? { projectId: entry.backendProjectId, projectIdEnv: undefined }
      : {}),
    ...(entry.backendProjectName ? { projectName: entry.backendProjectName } : {}),
    ...(entry.backendEnvironment ? { defaultEnvironment: entry.backendEnvironment } : {}),
    ...(entry.backendSecretPath ? { defaultPath: entry.backendSecretPath } : {}),
  };
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
