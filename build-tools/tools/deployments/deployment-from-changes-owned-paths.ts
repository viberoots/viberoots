#!/usr/bin/env zx-wrapper
import { packagePathFromLabel } from "../lib/labels.ts";
import { toSortedUnique } from "../lib/project-graph.ts";
import { componentTargetsFor, type DeploymentTarget } from "./contract.ts";

function cleanRepoPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function packagePrefixesForLabels(labels: string[]): string[] {
  return toSortedUnique(
    labels
      .map((label) => cleanRepoPath(packagePathFromLabel(label)))
      .map((packagePath) => packagePath.slice(0, packagePath.lastIndexOf("/") + 1))
      .filter(Boolean),
  );
}

function withSiblingProjectPrefixes(prefixes: string[]): string[] {
  return toSortedUnique(
    prefixes.flatMap((prefix) => {
      if (prefix.endsWith("/apps/")) return [prefix, prefix.replace(/\/apps\/$/, "/libs/")];
      if (prefix.endsWith("/libs/")) return [prefix, prefix.replace(/\/libs\/$/, "/apps/")];
      return [prefix];
    }),
  );
}

export function ownedComponentProjectPrefixes(deployments: DeploymentTarget[]): string[] {
  return withSiblingProjectPrefixes(
    packagePrefixesForLabels(deployments.flatMap((deployment) => componentTargetsFor(deployment))),
  );
}

export function ownedDeploymentPrefixes(deployments: DeploymentTarget[]): string[] {
  return packagePrefixesForLabels(deployments.map((deployment) => deployment.label));
}

export function ownedWorkspaceRoots(
  componentProjectPrefixes: string[],
  deploymentPrefixes: string[],
): string[] {
  return toSortedUnique(
    [...componentProjectPrefixes, ...deploymentPrefixes]
      .map((prefix) => prefix.split("/")[0] || "")
      .filter(Boolean)
      .map((segment) => `${segment}/`),
  );
}
