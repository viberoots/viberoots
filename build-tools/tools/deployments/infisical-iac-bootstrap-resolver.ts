#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  withBootstrapKeychainServiceName,
  withRepoKeychainServiceName,
} from "./infisical-iac-bootstrap-config";
import {
  initLocalSprinkleRefValues,
  initSprinkleRefConfigs,
  macosKeychainMainDefault,
  VAULT_DEFAULT,
} from "./sprinkleref-templates";
import { starterInfisicalProfile } from "./infisical-iac-bootstrap-profile-kind";
import type {
  SprinkleRefBackendConfig,
  SprinkleRefConfig,
  SprinkleRefConfigFile,
} from "./sprinkleref-types";
import {
  addCategoryProfiles,
  bootstrapCredentialProfiles,
  requiredBackendProfiles,
  validateRepoResolverConfig,
} from "./infisical-iac-bootstrap-resolver-profiles";

export {
  requiredBackendProfiles,
  validateRepoResolverConfig,
} from "./infisical-iac-bootstrap-resolver-profiles";

const STARTER_CATEGORY_PROFILES = ["infisical-default"];
const REPO_BACKENDS = new Set(["infisical", "vault", "macos-keychain", "keychain"]);
const PROFILE_ALIAS = /^[a-z0-9][a-z0-9-]*$/;

export async function ensureRepoResolverConfig(opts: {
  dryRun: boolean;
  platform?: NodeJS.Platform;
  graphPath?: string;
  workspaceRoot?: string;
  configPath?: string;
  secretBackend?: string;
  keychainServiceName?: string;
  bootstrapKeychainServiceName?: string;
}) {
  const workspaceRoot = opts.workspaceRoot || (await findRepoRoot(process.cwd()));
  const configPath =
    opts.configPath || resolverConfigPath(path.join(workspaceRoot, "projects", "config"));
  const exists = await fileExists(configPath);
  if (!exists) {
    const profiles = await repoBootstrapProfiles({
      graphPath: opts.graphPath,
      workspaceRoot,
      starterCategoryProfiles: !opts.secretBackend?.trim(),
      explicitSecretBackend: opts.secretBackend,
    });
    if (opts.dryRun) {
      return {
        configPath,
        workspaceRoot,
        profiles,
        bootstrapCredentialProfiles: profiles.filter((profile) => profile.startsWith("infisical-")),
        validated: false,
      };
    }
    await initSprinkleRefConfigs({
      dir: path.dirname(configPath),
      platform: opts.platform || process.platform,
      mode: "create",
      workspaceRoot,
    });
    await initLocalSprinkleRefValues(workspaceRoot);
  }
  const repoKeychainServiceName = (
    await withRepoKeychainServiceName(
      { ...DEFAULT_BOOTSTRAP_ARGS, keychainServiceName: opts.keychainServiceName },
      workspaceRoot,
    )
  ).keychainServiceName;
  const bootstrapKeychainServiceName = (
    await withBootstrapKeychainServiceName(
      {
        ...DEFAULT_BOOTSTRAP_ARGS,
        bootstrapKeychainServiceName: opts.bootstrapKeychainServiceName,
      },
      workspaceRoot,
    )
  ).bootstrapKeychainServiceName;
  if (!opts.dryRun) {
    await repairBootstrapKeychainService(configPath, bootstrapKeychainServiceName);
  }
  if (opts.secretBackend?.trim() && !opts.dryRun) {
    await selectRepoSecretBackend(configPath, opts.secretBackend, repoKeychainServiceName);
  }
  const config = await readSprinkleRefConfig(configPath, workspaceRoot);
  const requiredProfiles = new Set(
    await repoBootstrapProfiles({
      graphPath: opts.graphPath,
      workspaceRoot,
      config,
      explicitSecretBackend: opts.secretBackend,
    }),
  );
  validateRepoResolverConfig(config, requiredProfiles);
  return {
    configPath,
    workspaceRoot,
    profiles: [...requiredProfiles].sort(),
    bootstrapCredentialProfiles: bootstrapCredentialProfiles(config, requiredProfiles),
    validated: true,
  };
}

export async function repoBootstrapProfiles(opts: {
  graphPath?: string;
  workspaceRoot?: string;
  config?: SprinkleRefConfig;
  starterCategoryProfiles?: boolean;
  explicitSecretBackend?: string;
}) {
  const profiles = await requiredBackendProfiles(opts.graphPath, opts.workspaceRoot);
  if (opts.config) addCategoryProfiles(profiles, opts.config);
  if (opts.explicitSecretBackend?.trim()) {
    const selector = normalizeExplicitSecretBackend(opts.explicitSecretBackend);
    profiles.add(selector.profile);
  }
  if (opts.starterCategoryProfiles) {
    for (const profile of STARTER_CATEGORY_PROFILES) profiles.add(profile);
  }
  return [...profiles].sort();
}

async function selectRepoSecretBackend(
  configPath: string,
  secretBackend: string,
  keychainServiceName?: string,
) {
  const selector = normalizeExplicitSecretBackend(secretBackend);
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as SprinkleRefConfigFile & {
    sprinkleref?: SprinkleRefConfigFile;
  };
  const resolver = raw.sprinkleref || raw;
  resolver.profiles = { ...(resolver.profiles || {}) };
  resolver.categories = { ...(resolver.categories || {}) };
  resolver.profiles[selector.profile] ||= starterProfileForSelector(selector, keychainServiceName);
  resolver.defaultCategory = "main";
  resolver.categories.main = { profile: selector.profile };
  if (raw.sprinkleref) raw.sprinkleref = resolver;
  await fs.writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

async function repairBootstrapKeychainService(
  configPath: string,
  bootstrapKeychainServiceName: string,
) {
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as SprinkleRefConfigFile & {
    sprinkleref?: SprinkleRefConfigFile;
    runtimeHosts?: Record<string, SprinkleRefBackendConfig>;
  };
  const resolver = raw.sprinkleref || raw;
  const bootstrap = resolver.categories?.bootstrap;
  let changed = false;
  if (bootstrap && !("profile" in bootstrap) && bootstrap.backend === "macos-keychain") {
    changed = repairKeychainBackendService(bootstrap, bootstrapKeychainServiceName) || changed;
  }
  const localMacos = raw.runtimeHosts?.["local-macos"];
  if (localMacos?.backend === "macos-keychain") {
    changed = repairKeychainBackendService(localMacos, bootstrapKeychainServiceName) || changed;
  }
  if (!changed) return;
  if (raw.sprinkleref) raw.sprinkleref = resolver;
  await fs.writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
}

function repairKeychainBackendService(
  backend: SprinkleRefBackendConfig,
  keychainServiceName: string,
) {
  if (backend.service && backend.service !== "viberoots-bootstrap") return false;
  backend.service = keychainServiceName;
  return true;
}

function normalizeExplicitSecretBackend(secretBackend: string) {
  const [backend = "", alias = ""] = secretBackend.trim().split("/");
  const errors: string[] = [];
  if (!backend || !alias || secretBackend.trim().split("/").length !== 2) {
    errors.push(
      'secret backend must use "<backend>/<profile-alias>", for example "infisical/default"',
    );
  }
  if (backend && !REPO_BACKENDS.has(backend)) {
    errors.push(`unsupported repo secret backend "${backend}"`);
  }
  if (alias && !PROFILE_ALIAS.test(alias)) {
    errors.push("secret backend profile alias must be kebab-case, for example default or personal");
  }
  if (errors.length > 0) throw new Error(errors.join("; "));
  const normalizedBackend = backend === "keychain" ? "macos-keychain" : backend;
  return {
    backend: normalizedBackend as "infisical" | "vault" | "macos-keychain",
    profile: `${normalizedBackend}-${alias}`,
  };
}

function starterProfileForSelector(
  selector: ReturnType<typeof normalizeExplicitSecretBackend>,
  keychainServiceName?: string,
): SprinkleRefBackendConfig {
  if (selector.backend === "vault") return { ...VAULT_DEFAULT };
  if (selector.backend === "macos-keychain")
    return keychainServiceName
      ? { backend: "macos-keychain", service: keychainServiceName }
      : macosKeychainMainDefault();
  return starterInfisicalProfile();
}

async function fileExists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
