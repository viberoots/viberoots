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

const BACKENDS = new Set<SprinkleRefBackendKind>([
  "infisical",
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
  const backendName = ref
    .slice("secret://".length)
    .split("/")
    .map((part) => part.trim())
    .find((part) => BACKEND_NAMES.has(part));
  if (backendName) {
    throw new Error(`secret ref must be backend-neutral; move ${backendName} to resolver config`);
  }
}

export async function readSprinkleRefConfig(configPath?: string): Promise<SprinkleRefConfig> {
  const selected = configPath || process.env.SPRINKLEREF_CONFIG || "";
  if (!selected) throw new Error("missing SprinkleRef config; pass --config or SPRINKLEREF_CONFIG");
  return loadConfig(path.resolve(selected), new Set());
}

async function loadConfig(file: string, seen: Set<string>): Promise<SprinkleRefConfig> {
  if (seen.has(file)) throw new Error(`circular SprinkleRef config extends: ${file}`);
  seen.add(file);
  const raw = parseConfig(await fs.readFile(file, "utf8"), file);
  const base = raw.extends
    ? await loadConfig(path.resolve(path.dirname(file), raw.extends), seen)
    : emptyConfig();
  return validateConfig(
    {
      path: file,
      defaultCategory: raw.defaultCategory || base.defaultCategory,
      profiles: { ...base.profiles, ...(raw.profiles || {}) },
      categories: { ...base.categories, ...(raw.categories || {}) },
    },
    file,
  );
}

function parseConfig(text: string, file: string): SprinkleRefConfigFile {
  try {
    return JSON.parse(stripJsonComments(text)) as SprinkleRefConfigFile;
  } catch {
    throw new Error(`invalid SprinkleRef config JSON: ${file}`);
  }
}

function emptyConfig(): SprinkleRefConfig {
  return { defaultCategory: "main", profiles: {}, categories: {} };
}

export function validateConfig(config: SprinkleRefConfig, file = "SprinkleRef config") {
  const profiles = config.profiles || {};
  const categories = config.categories || {};
  if (!config.defaultCategory.trim()) throw new Error(`${file} defaultCategory is required`);
  if (!categories[config.defaultCategory]) {
    throw new Error(`${file} missing default category ${config.defaultCategory}`);
  }
  for (const [name, profile] of Object.entries(profiles)) validateBackend(file, name, profile);
  for (const [name, category] of Object.entries(categories))
    validateCategory(file, name, category, profiles);
  return config;
}

function validateCategory(
  file: string,
  name: string,
  category: SprinkleRefCategoryConfig,
  profiles: Record<string, SprinkleRefBackendConfig>,
) {
  if ("profile" in category) {
    if (!profiles[category.profile]) {
      throw new Error(`${file} category ${name} references missing profile ${category.profile}`);
    }
    return;
  }
  validateBackend(file, name, category);
}

function validateBackend(file: string, name: string, backend: SprinkleRefBackendConfig) {
  if (!BACKENDS.has(backend.backend)) {
    throw new Error(`${file} category ${name} has unsupported backend ${String(backend.backend)}`);
  }
  if (backend.backend === "local-file" && !backend.file) {
    throw new Error(`${file} category ${name} local-file backend requires file`);
  }
  if (backend.backend === "macos-keychain" && !backend.service) {
    throw new Error(`${file} category ${name} macos-keychain backend requires service`);
  }
  if (backend.backend === "infisical") validateInfisical(file, name, backend);
}

function validateInfisical(file: string, name: string, backend: SprinkleRefBackendConfig) {
  if (backend.projectRef) {
    throw new Error(
      `${file} category ${name} infisical backend uses unsupported projectRef; use projectId`,
    );
  }
  for (const key of ["host", "projectId", "defaultEnvironment"] as const) {
    if (!backend[key])
      throw new Error(`${file} category ${name} infisical backend requires ${key}`);
  }
  if (!backend.clientIdEnv && !backend.tokenEnv) {
    throw new Error(`${file} category ${name} infisical backend requires clientIdEnv or tokenEnv`);
  }
  if (backend.clientIdEnv && !backend.clientSecretEnv) {
    throw new Error(`${file} category ${name} infisical backend requires clientSecretEnv`);
  }
}

export function resolveSprinkleRefBackend(config: SprinkleRefConfig, category?: string) {
  const selected = category || config.defaultCategory;
  const entry = config.categories[selected];
  if (!entry) throw new Error(`SprinkleRef category ${selected} is not configured`);
  if ("profile" in entry) {
    const backend = config.profiles[entry.profile];
    if (!backend) throw new Error(`SprinkleRef profile ${entry.profile} is not configured`);
    return { category: selected, profile: entry.profile, backend };
  }
  return { category: selected, backend: entry };
}
