#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { createDeploymentExtractionContext, uniqueErrors } from "./contract-extract-shared.ts";
import { extractAppStoreConnectDeploymentsFromContext } from "./contract-extract-app-store-connect.ts";
import { extractCloudflarePagesDeploymentsFromContext } from "./contract-extract-cloudflare-pages.ts";
import { extractGooglePlayDeploymentsFromContext } from "./contract-extract-google-play.ts";
import { extractKubernetesDeploymentsFromContext } from "./contract-extract-kubernetes.ts";
import { extractNixosSharedHostDeploymentsFromContext } from "./contract-extract-nixos-shared-host.ts";
import { extractS3StaticDeploymentsFromContext } from "./contract-extract-s3-static.ts";
import { extractVercelDeploymentsFromContext } from "./contract-extract-vercel.ts";

export function extractNixosSharedHostDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractNixosSharedHostDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractCloudflarePagesDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractCloudflarePagesDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractAppStoreConnectDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractAppStoreConnectDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractGooglePlayDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractGooglePlayDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractS3StaticDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractS3StaticDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractKubernetesDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractKubernetesDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractVercelDeployments(nodes: GraphNode[]) {
  const context = createDeploymentExtractionContext(nodes);
  return {
    deployments: extractVercelDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export * from "./contract-types.ts";
export * from "./contract-extract.ts";
export * from "./contract-extract-cloudflare-pages.ts";
export * from "./contract-extract-app-store-connect.ts";
export * from "./contract-extract-google-play.ts";
export * from "./contract-extract-kubernetes.ts";
export * from "./contract-extract-nixos-shared-host.ts";
export * from "./contract-extract-s3-static.ts";
export * from "./contract-extract-vercel.ts";
export * from "./deployment-targets.ts";
export * from "./deployment-provider-targets.ts";
