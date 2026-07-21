#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  SprinkleRefBackendConfig,
  SprinkleRefConfig,
  SprinkleRefConfigFile,
} from "./sprinkleref-types";
import { stripJsonComments } from "./json-comments";
import { PROJECT_SHARED_CONFIG_PATH, readProjectConfig } from "./project-config";
import {
  materializeRuntimeHost,
  readProjectEnvironments,
  rejectRetiredConfigPath,
  withNamedEnvironment,
} from "./sprinkleref-config-environments";
import { validateSprinkleRefConfig } from "./sprinkleref-config-validation";

const BACKEND_NAMES = new Set([
  "infisical",
  "vault",
  "local-file",
  "macos-keychain",
  "github-actions",
  "jenkins",
  "gitlab-ci",
  "bitbucket-pipelines",
  "github",
  "gitlab",
  "bitbucket",
]);

export function assertBackendNeutralSecretRef(ref: string) {
  if (!ref.startsWith("secret://")) throw new Error(`secret ref must start with secret://: ${ref}`);
  assertBackendNeutralRef(ref);
}

export function assertBackendNeutralRef(ref: string) {
  const backendName = ref
    .slice(ref.indexOf("://") + "://".length)
    .split("/")
    .map((part) => part.trim())
    .find((part) => BACKEND_NAMES.has(part));
  if (backendName) {
    throw new Error(`ref must be backend-neutral; move ${backendName} to resolver config`);
  }
}

export async function readSprinkleRefConfig(
  configPath?: string,
  cwd = process.cwd(),
): Promise<SprinkleRefConfig> {
  const selected = configPath || process.env.SPRINKLEREF_CONFIG || "";
  if (!selected) return await readProjectSprinkleRefConfig(cwd);
  const selectedPath = path.isAbsolute(selected) ? selected : path.resolve(cwd, selected);
  if (selectedPath === path.resolve(cwd, PROJECT_SHARED_CONFIG_PATH)) {
    return await readProjectSprinkleRefConfig(cwd);
  }
  rejectRetiredConfigPath(selected);
  return loadConfig(selectedPath);
}

async function readProjectSprinkleRefConfig(cwd: string): Promise<SprinkleRefConfig> {
  const loaded = await readProjectConfig(cwd);
  const raw = loaded.config.sprinkleref;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("missing projects/config/shared.json sprinkleref config");
  }
  const config = raw as SprinkleRefConfigFile;
  const materialized = materializeRuntimeHost(config, loaded.config, process.env);
  if (process.env.VBR_DISALLOW_LOCAL_OVERRIDES === "1" && loaded.overrides.length) {
    throw new Error(
      `local project config overrides are disabled: ${loaded.overrides.map((entry) => entry.path).join(", ")}`,
    );
  }
  return validateConfig(
    {
      path: loaded.localPresent ? `${loaded.sharedPath} + ${loaded.localPath}` : loaded.sharedPath,
      defaultCategory: materialized.defaultCategory || "main",
      bootstrapScope: stringField(materialized.bootstrapScope),
      repoInfisicalProjectName: stringField(materialized.repoInfisicalProjectName),
      bootstrapKeychainServiceName: stringField(materialized.bootstrapKeychainServiceName),
      repoKeychainServiceName: stringField(materialized.repoKeychainServiceName),
      environments: readProjectEnvironments(loaded.config),
      profiles: materialized.profiles || {},
      categories: materialized.categories || {},
      overrides: loaded.overrides,
    },
    "projects/config",
  );
}

async function loadConfig(file: string): Promise<SprinkleRefConfig> {
  const parsed = parseConfig(await fs.readFile(file, "utf8"), file);
  const raw = materializeRuntimeHost(projectWrappedConfig(parsed), parsed, process.env);
  if (raw.extends) {
    throw new Error(
      "SprinkleRef config extends is no longer supported; use projects/config/shared.json plus local.json",
    );
  }
  return validateConfig(
    {
      path: file,
      defaultCategory: raw.defaultCategory || "main",
      bootstrapScope: stringField(raw.bootstrapScope),
      repoInfisicalProjectName: stringField(raw.repoInfisicalProjectName),
      bootstrapKeychainServiceName: stringField(raw.bootstrapKeychainServiceName),
      repoKeychainServiceName: stringField(raw.repoKeychainServiceName),
      environments: raw.environments || readProjectEnvironments(parsed),
      profiles: raw.profiles || {},
      categories: raw.categories || {},
    },
    file,
  );
}

function parseConfig(text: string, file: string): Record<string, unknown> {
  try {
    return JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  } catch {
    throw new Error(`invalid SprinkleRef config JSON: ${file}`);
  }
}

function projectWrappedConfig(raw: Record<string, unknown>): SprinkleRefConfigFile {
  if (raw.sprinkleref && typeof raw.sprinkleref === "object" && !Array.isArray(raw.sprinkleref)) {
    return raw.sprinkleref as SprinkleRefConfigFile;
  }
  return raw as SprinkleRefConfigFile;
}

export function validateConfig(config: SprinkleRefConfig, file = "SprinkleRef config") {
  return validateSprinkleRefConfig(config, file);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function resolveSprinkleRefBackend(config: SprinkleRefConfig, category?: string) {
  const selected = category || config.defaultCategory;
  const entry = config.categories[selected];
  if (!entry) throw new Error(`SprinkleRef category ${selected} is not configured`);
  if ("profile" in entry) {
    const backend = config.profiles[entry.profile];
    if (!backend) throw new Error(`SprinkleRef profile ${entry.profile} is not configured`);
    return {
      category: selected,
      profile: entry.profile,
      backend: withNamedEnvironment("", selected, backend, entry, config.environments || {}),
    };
  }
  return {
    category: selected,
    backend: withNamedEnvironment("", selected, entry, entry, config.environments || {}),
  };
}
