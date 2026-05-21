#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { readGraph, type GraphNode } from "../lib/graph";
import {
  deploymentSecretBackendSelectorErrors,
  normalizeDeploymentSecretBackendSelector,
} from "./deployment-secret-backend-selector";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { resolveBootstrapAccessCredentialSinkBackend } from "./sprinkleref-bootstrap-guard";
import { initSprinkleRefConfigs } from "./sprinkleref-templates";
import type { SprinkleRefConfig } from "./sprinkleref-types";

const STARTER_CATEGORY_PROFILES = ["infisical-default"];

export async function ensureRepoResolverConfig(opts: {
  dryRun: boolean;
  platform?: NodeJS.Platform;
  graphPath?: string;
  configPath?: string;
}) {
  const configPath = opts.configPath || resolverConfigPath();
  const exists = await fileExists(configPath);
  if (!exists) {
    const profiles = await repoBootstrapProfiles({
      graphPath: opts.graphPath,
      starterCategoryProfiles: true,
    });
    if (opts.dryRun) {
      return {
        configPath,
        profiles,
        bootstrapCredentialProfiles: profiles.filter((profile) => profile.startsWith("infisical-")),
        validated: false,
      };
    }
    await initSprinkleRefConfigs({
      dir: "sprinkleref",
      platform: opts.platform || process.platform,
      mode: "create",
    });
  }
  const config = await readSprinkleRefConfig(configPath);
  const requiredProfiles = new Set(
    await repoBootstrapProfiles({ graphPath: opts.graphPath, config }),
  );
  validateRepoResolverConfig(config, requiredProfiles);
  return {
    configPath,
    profiles: [...requiredProfiles].sort(),
    bootstrapCredentialProfiles: bootstrapCredentialProfiles(config, requiredProfiles),
    validated: true,
  };
}

export async function repoBootstrapProfiles(opts: {
  graphPath?: string;
  config?: SprinkleRefConfig;
  starterCategoryProfiles?: boolean;
}) {
  const profiles = await requiredBackendProfiles(opts.graphPath || DEFAULT_GRAPH_PATH);
  if (opts.config) addCategoryProfiles(profiles, opts.config);
  if (opts.starterCategoryProfiles) {
    for (const profile of STARTER_CATEGORY_PROFILES) profiles.add(profile);
  }
  return [...profiles].sort();
}

export async function requiredBackendProfiles(graphPath = DEFAULT_GRAPH_PATH) {
  const profiles = new Set<string>();
  const nodes = await readGraph(graphPath).catch(() => []);
  for (const node of nodes) {
    const secretBackend = stringAttr(node, "secret_backend");
    const secretBackendProfile = stringAttr(node, "secret_backend_profile");
    if (!secretBackend && !secretBackendProfile) continue;
    const errors = deploymentSecretBackendSelectorErrors({ secretBackend, secretBackendProfile });
    if (errors.length > 0) {
      const label = stringAttr(node, "name") || "<unknown deployment>";
      throw new Error(`${label}: ${errors.join("; ")}`);
    }
    profiles.add(
      normalizeDeploymentSecretBackendSelector({ secretBackend, secretBackendProfile }).profile,
    );
  }
  return profiles;
}

export function validateRepoResolverConfig(
  config: SprinkleRefConfig,
  requiredProfiles: Set<string>,
) {
  for (const profile of requiredProfiles) {
    const backend = config.profiles[profile];
    if (!backend && profile.startsWith("infisical-")) continue;
    if (!backend) throw new Error(`SprinkleRef config missing profile ${profile}`);
    validateRepoProfile(profile, backend);
  }
  for (const category of ["main", "bootstrap"]) {
    if (!config.categories[category]) {
      throw new Error(`SprinkleRef config missing category ${category}`);
    }
  }
  resolveBootstrapAccessCredentialSinkBackend(config, "bootstrap");
}

function validateRepoProfile(profile: string, config: { backend: string }) {
  if (profile.startsWith("vault-") && config.backend !== "vault") {
    throw new Error(
      `SprinkleRef config profile ${profile} must use vault backend; run repo bootstrap to materialize Vault metadata`,
    );
  }
  if (profile.startsWith("infisical-") && config.backend !== "infisical") {
    throw new Error(
      `SprinkleRef config profile ${profile} must use infisical backend; run repo bootstrap to materialize Infisical metadata`,
    );
  }
}

function bootstrapCredentialProfiles(config: SprinkleRefConfig, requiredProfiles: Set<string>) {
  return [...requiredProfiles]
    .filter(
      (profile) =>
        profile.startsWith("infisical-") || config.profiles[profile]?.backend === "infisical",
    )
    .sort();
}

function addCategoryProfiles(profiles: Set<string>, config: SprinkleRefConfig) {
  for (const profile of activeCategoryProfiles(config)) profiles.add(profile);
}

function activeCategoryProfiles(config: SprinkleRefConfig) {
  return Object.values(config.categories)
    .map((category) => ("profile" in category ? category.profile.trim() : ""))
    .filter(Boolean);
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

function stringAttr(node: GraphNode, key: string) {
  const value = node[key];
  return typeof value === "string" ? value.trim() : "";
}
