#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  SprinkleRefBackendConfig,
  SprinkleRefBackendKind,
  SprinkleRefCategoryConfig,
  SprinkleRefConfig,
  SprinkleRefConfigFile,
} from "./sprinkleref-types";
import { stripJsonComments } from "./json-comments";
import { PROJECT_SHARED_CONFIG_PATH, readProjectConfig } from "./project-config";
import { normalizeBootstrapScope } from "./infisical-iac-bootstrap-scope";
import {
  materializeRuntimeHost,
  readProjectEnvironments,
  rejectRetiredConfigPath,
  withNamedEnvironment,
} from "./sprinkleref-config-environments";

const BACKENDS = new Set<SprinkleRefBackendKind>([
  "infisical",
  "vault",
  "local-file",
  "macos-keychain",
  "github-actions",
  "jenkins",
  "gitlab-ci",
  "bitbucket-pipelines",
]);
const BACKEND_NAMES = new Set([...BACKENDS, "github", "gitlab", "bitbucket"]);

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

function emptyConfig(): SprinkleRefConfig {
  return { defaultCategory: "main", environments: {}, profiles: {}, categories: {} };
}

export function validateConfig(config: SprinkleRefConfig, file = "SprinkleRef config") {
  const profiles = config.profiles || {};
  const categories = config.categories || {};
  if (!config.defaultCategory.trim()) throw new Error(`${file} defaultCategory is required`);
  if (config.bootstrapScope) normalizeBootstrapScope(config.bootstrapScope);
  if (!categories[config.defaultCategory]) {
    throw new Error(`${file} missing default category ${config.defaultCategory}`);
  }
  for (const [name, profile] of Object.entries(profiles))
    validateBackend(file, name, profile, { requireEnvironment: false });
  for (const [name, category] of Object.entries(categories))
    validateCategory(file, name, category, profiles, config.environments || {});
  return config;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function validateCategory(
  file: string,
  name: string,
  category: SprinkleRefCategoryConfig,
  profiles: Record<string, SprinkleRefBackendConfig>,
  environments: NonNullable<SprinkleRefConfig["environments"]>,
) {
  if ("profile" in category) {
    const profile = profiles[category.profile];
    if (!profile) {
      throw new Error(`${file} category ${name} references missing profile ${category.profile}`);
    }
    validateBackend(file, name, withNamedEnvironment(file, name, profile, category, environments), {
      requireEnvironment: true,
    });
    return;
  }
  validateBackend(file, name, withNamedEnvironment(file, name, category, category, environments), {
    requireEnvironment: true,
  });
}

function validateBackend(
  file: string,
  name: string,
  backend: SprinkleRefBackendConfig,
  opts: { requireEnvironment: boolean },
) {
  if (!BACKENDS.has(backend.backend)) {
    throw new Error(`${file} category ${name} has unsupported backend ${String(backend.backend)}`);
  }
  if (backend.backend === "local-file" && !backend.file) {
    throw new Error(`${file} category ${name} local-file backend requires file`);
  }
  if (backend.backend === "macos-keychain" && !backend.service) {
    throw new Error(`${file} category ${name} macos-keychain backend requires service`);
  }
  if (backend.backend === "infisical") validateInfisical(file, name, backend, opts);
  if (backend.backend === "vault") validateVault(file, name, backend);
}

function validateInfisical(
  file: string,
  name: string,
  backend: SprinkleRefBackendConfig,
  opts: { requireEnvironment: boolean },
) {
  if (backend.projectRef) {
    throw new Error(
      `${file} category ${name} infisical backend uses unsupported projectRef; use projectId`,
    );
  }
  if (!backend.host) {
    throw new Error(`${file} category ${name} infisical backend requires host`);
  }
  if (opts.requireEnvironment && !backend.defaultEnvironment) {
    throw new Error(`${file} category ${name} infisical backend requires defaultEnvironment`);
  }
  if (!backend.projectId && !backend.projectIdEnv) {
    throw new Error(
      `${file} category ${name} infisical backend requires projectId or projectIdEnv`,
    );
  }
  if (backend.tokenEnv) {
    throw new Error(
      `${file} category ${name} infisical backend does not support tokenEnv; use Universal Auth clientIdEnv and clientSecretEnv`,
    );
  }
  if (!backend.clientIdEnv && !backend.clientIdRef) {
    throw new Error(
      `${file} category ${name} infisical backend requires clientIdEnv or clientIdRef`,
    );
  }
  if (!backend.clientSecretEnv && !backend.clientSecretRef) {
    throw new Error(
      `${file} category ${name} infisical backend requires clientSecretEnv or clientSecretRef`,
    );
  }
}

function validateVault(file: string, name: string, backend: SprinkleRefBackendConfig) {
  if (!backend.address && !backend.addressEnv) {
    throw new Error(`${file} category ${name} vault backend requires address or addressEnv`);
  }
  for (const key of ["mount", "defaultPath", "tokenEnv"] as const) {
    if (!backend[key]) throw new Error(`${file} category ${name} vault backend requires ${key}`);
  }
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
