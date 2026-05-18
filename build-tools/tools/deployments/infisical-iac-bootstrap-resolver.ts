#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { readGraph, type GraphNode } from "../lib/graph";
import { defaultDeploymentSecretBackendProfile } from "./deployment-secret-profile";
import { resolverConfigPath } from "./infisical-iac-bootstrap-preflight";
import { readSprinkleRefConfig } from "./sprinkleref-config";
import { resolveBootstrapAccessCredentialSinkBackend } from "./sprinkleref-bootstrap-guard";
import { initSprinkleRefConfigs } from "./sprinkleref-templates";
import type { SprinkleRefConfig } from "./sprinkleref-types";
import type { DeploymentSecretBackendKind } from "./deployment-sprinkle-ref";

const SUPPORTED_BACKENDS = new Set<DeploymentSecretBackendKind>(["vault", "infisical"]);

export async function ensureRepoResolverConfig(opts: {
  dryRun: boolean;
  platform?: NodeJS.Platform;
  graphPath?: string;
  configPath?: string;
}) {
  const configPath = opts.configPath || resolverConfigPath();
  const exists = await fileExists(configPath);
  if (!exists) {
    if (opts.dryRun) {
      return {
        configPath,
        profiles: ["vault-default", "infisical-default"],
        bootstrapCredentialProfiles: ["infisical-default"],
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
  const requiredProfiles = await requiredBackendProfiles(opts.graphPath || DEFAULT_GRAPH_PATH);
  validateRepoResolverConfig(config, requiredProfiles);
  return {
    configPath,
    profiles: [...requiredProfiles].sort(),
    bootstrapCredentialProfiles: bootstrapCredentialProfiles(config, requiredProfiles),
    validated: true,
  };
}

export async function requiredBackendProfiles(graphPath = DEFAULT_GRAPH_PATH) {
  const profiles = new Set(["vault-default", "infisical-default"]);
  const nodes = await readGraph(graphPath).catch(() => []);
  for (const node of nodes) {
    const explicit = stringAttr(node, "secret_backend_profile");
    if (explicit) {
      profiles.add(explicit);
      continue;
    }
    const backend = stringAttr(node, "secret_backend") as DeploymentSecretBackendKind;
    if (SUPPORTED_BACKENDS.has(backend))
      profiles.add(defaultDeploymentSecretBackendProfile(backend));
  }
  return profiles;
}

export function validateRepoResolverConfig(
  config: SprinkleRefConfig,
  requiredProfiles: Set<string>,
) {
  for (const profile of requiredProfiles) {
    if (!config.profiles[profile]) throw new Error(`SprinkleRef config missing profile ${profile}`);
  }
  for (const category of ["main", "bootstrap"]) {
    if (!config.categories[category]) {
      throw new Error(`SprinkleRef config missing category ${category}`);
    }
  }
  resolveBootstrapAccessCredentialSinkBackend(config, "bootstrap");
}

function bootstrapCredentialProfiles(config: SprinkleRefConfig, requiredProfiles: Set<string>) {
  return [...requiredProfiles]
    .filter((profile) => config.profiles[profile]?.backend === "infisical")
    .sort();
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
