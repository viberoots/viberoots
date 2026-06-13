#!/usr/bin/env zx-wrapper
import path from "node:path";

export const WORKSPACE_STATE_DIR = path.join(".viberoots", "workspace");
export const WORKSPACE_BUCK_STATE_DIR = path.join(WORKSPACE_STATE_DIR, "buck");
export const WORKSPACE_PROVIDER_DIR = path.join(WORKSPACE_STATE_DIR, "providers");

export const DEFAULT_GRAPH_PATH = path.join(WORKSPACE_BUCK_STATE_DIR, "graph.json");
export const DEFAULT_NODE_LOCK_INDEX_PATH = path.join(
  WORKSPACE_BUCK_STATE_DIR,
  "node-lock-index.json",
);
export const DEFAULT_INVALIDATION_REPORT_PATH = path.join(
  WORKSPACE_BUCK_STATE_DIR,
  "invalidation-report.txt",
);

export const DEFAULT_AUTO_MAP_PATH = path.join(WORKSPACE_PROVIDER_DIR, "auto_map.bzl");
export const DEFAULT_PROVIDER_TARGETS_PATH = path.join(WORKSPACE_PROVIDER_DIR, "TARGETS");
export const DEFAULT_PROVIDER_INDEX_PATH = path.join(WORKSPACE_PROVIDER_DIR, "provider_index.bzl");
export const DEFAULT_PROVIDER_INDEX_JSON_PATH = path.join(
  WORKSPACE_PROVIDER_DIR,
  "provider_index.json",
);
export const DEFAULT_NIX_ATTR_MAP_PATH = path.join(WORKSPACE_PROVIDER_DIR, "nix_attr_map.bzl");

export const LEGACY_PROVIDER_DIR = path.join("third_party", "providers");
export const LEGACY_GRAPH_PATH = path.join("build-tools", "tools", "buck", "graph.json");
export const LEGACY_NODE_LOCK_INDEX_PATH = path.join(
  "build-tools",
  "tools",
  "buck",
  "node-lock-index.json",
);
export const LEGACY_AUTO_MAP_PATH = path.join(LEGACY_PROVIDER_DIR, "auto_map.bzl");
export const LEGACY_PROVIDER_INDEX_JSON_PATH = path.join(
  LEGACY_PROVIDER_DIR,
  "provider_index.json",
);

export function providerAutoTargetsPath(lang: string): string {
  return path.join(WORKSPACE_PROVIDER_DIR, `TARGETS.${lang}.auto`);
}

export function workspaceProviderLabel(name: string): string {
  return `workspace_providers//:${name}`;
}

export function rootProviderPackageLabel(name: string): string {
  return `//third_party/providers:${name}`;
}
