#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as syncFs from "node:fs";
import * as path from "node:path";
import { stripJsonComments } from "./json-comments";

export const PROJECT_CONFIG_DIR = "projects/config";
export const PROJECT_SHARED_CONFIG_PATH = `${PROJECT_CONFIG_DIR}/shared.json`;
export const PROJECT_LOCAL_CONFIG_PATH = `${PROJECT_CONFIG_DIR}/local.json`;

export type ProjectConfig = Record<string, unknown> & {
  sprinkleref?: Record<string, unknown>;
  runtimeHosts?: Record<string, unknown>;
  controlPlanes?: Record<string, unknown>;
  deploymentContexts?: Record<string, unknown>;
  activeRuntimeHost?: string;
  values?: Record<string, unknown>;
};

export type LoadedProjectConfig = {
  config: ProjectConfig;
  sharedPath: string;
  localPath: string;
  localPresent: boolean;
  overrides: ProjectConfigOverride[];
};

export type ProjectConfigOverride = {
  path: string;
  sharedValue: unknown;
  localValue: unknown;
};

export type RedactedProjectConfigOverride = {
  path: string;
  sharedValue: unknown;
  localValue: unknown;
};

export async function readProjectConfig(cwd = process.cwd()): Promise<LoadedProjectConfig> {
  const sharedPath = path.resolve(cwd, PROJECT_SHARED_CONFIG_PATH);
  const localPath = path.resolve(cwd, PROJECT_LOCAL_CONFIG_PATH);
  const shared = await readOptionalObject(sharedPath, PROJECT_SHARED_CONFIG_PATH);
  const local = await readOptionalObject(localPath, PROJECT_LOCAL_CONFIG_PATH);
  const overrides: ProjectConfigOverride[] = [];
  return {
    config: mergeProjectConfig(shared.value, local.value, "", overrides) as ProjectConfig,
    sharedPath,
    localPath,
    localPresent: local.present,
    overrides,
  };
}

export function readProjectConfigSync(cwd = process.cwd()): LoadedProjectConfig {
  const sharedPath = path.resolve(cwd, PROJECT_SHARED_CONFIG_PATH);
  const localPath = path.resolve(cwd, PROJECT_LOCAL_CONFIG_PATH);
  const shared = readOptionalObjectSync(sharedPath, PROJECT_SHARED_CONFIG_PATH);
  const local = readOptionalObjectSync(localPath, PROJECT_LOCAL_CONFIG_PATH);
  const overrides: ProjectConfigOverride[] = [];
  return {
    config: mergeProjectConfig(shared.value, local.value, "", overrides) as ProjectConfig,
    sharedPath,
    localPath,
    localPresent: local.present,
    overrides,
  };
}

export function projectValueEntryPath(refPath: string): string {
  return `values.${refPath.split("/").filter(Boolean).join(".")}`;
}

export function redactedProjectConfigOverrides(
  overrides: ProjectConfigOverride[],
): RedactedProjectConfigOverride[] {
  return overrides.map((entry) => ({
    path: entry.path,
    sharedValue: redactProjectConfigValue(entry.path, entry.sharedValue),
    localValue: redactProjectConfigValue(entry.path, entry.localValue),
  }));
}

export function formatProjectConfigOverride(entry: RedactedProjectConfigOverride): string {
  return `${entry.path}: shared=${stringifyDiagnosticValue(entry.sharedValue)} local=${stringifyDiagnosticValue(entry.localValue)}`;
}

async function readOptionalObject(file: string, label: string) {
  try {
    const parsed = JSON.parse(stripJsonComments(await fs.readFile(file, "utf8")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} root must be an object`);
    }
    return { present: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { present: false, value: {} };
    }
    if (error instanceof SyntaxError) throw new Error(`invalid project config JSON: ${label}`);
    throw error;
  }
}

function readOptionalObjectSync(file: string, label: string) {
  try {
    const parsed = JSON.parse(stripJsonComments(syncFs.readFileSync(file, "utf8")));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} root must be an object`);
    }
    return { present: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { present: false, value: {} };
    }
    if (error instanceof SyntaxError) throw new Error(`invalid project config JSON: ${label}`);
    throw error;
  }
}

function mergeProjectConfig(
  shared: unknown,
  local: unknown,
  keyPath: string,
  overrides: ProjectConfigOverride[],
): unknown {
  if (isPlainObject(shared) && isPlainObject(local)) {
    const next: Record<string, unknown> = { ...shared };
    for (const [key, localValue] of Object.entries(local)) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      next[key] = mergeProjectConfig(next[key], localValue, childPath, overrides);
    }
    return next;
  }
  if (local !== undefined) {
    if (
      keyPath !== "schemaVersion" &&
      shared !== undefined &&
      JSON.stringify(shared) !== JSON.stringify(local)
    ) {
      overrides.push({ path: keyPath, sharedValue: shared, localValue: local });
    }
    return local;
  }
  return shared;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function redactProjectConfigValue(keyPath: string, value: unknown): unknown {
  if (!isSecretLikePath(keyPath)) return value;
  if (value === undefined || value === null || value === "") return value;
  return "<redacted>";
}

function isSecretLikePath(keyPath: string): boolean {
  return /secret|token|password|credential|private|apikey|key/i.test(keyPath);
}

function stringifyDiagnosticValue(value: unknown): string {
  if (value === undefined) return "<unset>";
  if (typeof value === "string") return value || "<empty>";
  return JSON.stringify(value);
}
