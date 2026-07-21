import * as path from "node:path";
import type { GraphNode } from "../lib/graph";
import { readCompositeGraph } from "../lib/graph-view";
import { findRepoRoot } from "../lib/repo";
import { resolveDeploymentContextNodes } from "./deployment-contexts";
import {
  defaultDeploymentGraphPath,
  deploymentGraphReadOptions,
} from "./deployment-graph-read-options";
import {
  deploymentSecretBackendSelectorErrors,
  normalizeDeploymentSecretBackendSelector,
} from "./deployment-secret-backend-selector";
import { resolveBootstrapAccessCredentialSinkBackend } from "./sprinkleref-bootstrap-guard";
import type { SprinkleRefConfig } from "./sprinkleref-types";

export async function requiredBackendProfiles(graphPath?: string, workspaceRoot?: string) {
  const profiles = new Set<string>();
  const selectedWorkspaceRoot =
    workspaceRoot ||
    (graphPath ? await workspaceRootForGraph(graphPath) : await findRepoRoot(process.cwd()));
  const selectedGraphPath = graphPath || defaultDeploymentGraphPath(selectedWorkspaceRoot);
  const rawNodes = await readCompositeGraph(
    deploymentGraphReadOptions(selectedWorkspaceRoot, selectedGraphPath),
  )
    .then((graph) => graph.nodes)
    .catch(() => []);
  const contextErrors: string[] = [];
  const nodes = resolveDeploymentContextNodes(rawNodes, contextErrors, selectedWorkspaceRoot);
  if (contextErrors.length > 0) throw new Error(contextErrors.join("\n"));
  for (const node of nodes) {
    const secretBackend = stringAttr(node, "secret_backend");
    const secretBackendProfile = stringAttr(node, "secret_backend_profile");
    if (!secretBackend && !secretBackendProfile && !nodeNeedsSecretBackend(node)) continue;
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

export function bootstrapCredentialProfiles(
  config: SprinkleRefConfig,
  requiredProfiles: Set<string>,
) {
  return [...requiredProfiles]
    .filter(
      (profile) =>
        profile.startsWith("infisical-") || config.profiles[profile]?.backend === "infisical",
    )
    .sort();
}

export function addCategoryProfiles(profiles: Set<string>, config: SprinkleRefConfig) {
  const category = config.categories[config.defaultCategory || "main"];
  if (category && "profile" in category && category.profile.trim()) {
    profiles.add(category.profile.trim());
  }
}

function validateRepoProfile(profile: string, config: { backend: string }) {
  for (const [prefix, backend, name] of [
    ["vault-", "vault", "Vault"],
    ["infisical-", "infisical", "Infisical"],
    ["macos-keychain-", "macos-keychain", "Keychain"],
  ]) {
    if (profile.startsWith(prefix) && config.backend !== backend) {
      throw new Error(
        `SprinkleRef config profile ${profile} must use ${backend} backend; run repo bootstrap to materialize ${name} metadata`,
      );
    }
  }
}

async function workspaceRootForGraph(graphPath: string): Promise<string> {
  const abs = path.resolve(graphPath);
  for (const suffix of [
    path.join(".viberoots", "workspace", "buck", "graph.json"),
    path.join("build-tools", "tools", "buck", "graph.json"),
  ]) {
    if (abs.endsWith(suffix)) {
      return abs.slice(0, -suffix.length).replace(new RegExp(`${path.sep}$`), "");
    }
  }
  return await findRepoRoot(process.cwd());
}

function stringAttr(node: GraphNode, key: string) {
  const value = node[key];
  return typeof value === "string" ? value.trim() : "";
}

function nodeNeedsSecretBackend(node: GraphNode) {
  const value = node.secret_requirements;
  return Array.isArray(value) && value.length > 0;
}
