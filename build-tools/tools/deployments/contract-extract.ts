#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type { DeploymentTarget } from "./contract-types.ts";
import { createDeploymentExtractionContext, uniqueErrors } from "./contract-extract-shared.ts";
import { extractCloudflarePagesDeploymentsFromContext } from "./contract-extract-cloudflare-pages.ts";
import { extractNixosSharedHostDeploymentsFromContext } from "./contract-extract-nixos-shared-host.ts";

export function extractDeployments(nodes: GraphNode[]): {
  deployments: DeploymentTarget[];
  errors: string[];
} {
  const context = createDeploymentExtractionContext(nodes);
  const deployments = [
    ...extractNixosSharedHostDeploymentsFromContext(context),
    ...extractCloudflarePagesDeploymentsFromContext(context),
  ].sort((a, b) => a.label.localeCompare(b.label));
  return {
    deployments,
    errors: uniqueErrors(context.errors),
  };
}
