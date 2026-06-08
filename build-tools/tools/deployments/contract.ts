#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import type { DeploymentExtractionOptions } from "./contract-extract-options";
import { createDeploymentExtractionContext, uniqueErrors } from "./contract-extract-shared";
import { extractAppStoreConnectDeploymentsFromContext } from "./contract-extract-app-store-connect";
import { extractCloudflarePagesDeploymentsFromContext } from "./contract-extract-cloudflare-pages";
import { extractCloudflareContainersDeploymentsFromContext } from "./contract-extract-cloudflare-containers";
import { extractGooglePlayDeploymentsFromContext } from "./contract-extract-google-play";
import { extractKubernetesDeploymentsFromContext } from "./contract-extract-kubernetes";
import { extractNixosSharedHostDeploymentsFromContext } from "./contract-extract-nixos-shared-host";
import { extractS3StaticDeploymentsFromContext } from "./contract-extract-s3-static";
import { extractVercelDeploymentsFromContext } from "./contract-extract-vercel";

export function extractNixosSharedHostDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractNixosSharedHostDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractCloudflarePagesDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractCloudflarePagesDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractCloudflareContainersDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractCloudflareContainersDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractAppStoreConnectDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractAppStoreConnectDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractGooglePlayDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractGooglePlayDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractS3StaticDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractS3StaticDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractKubernetesDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractKubernetesDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export function extractVercelDeployments(
  nodes: GraphNode[],
  opts: DeploymentExtractionOptions = {},
) {
  const context = createDeploymentExtractionContext(nodes, opts);
  return {
    deployments: extractVercelDeploymentsFromContext(context),
    errors: uniqueErrors(context.errors),
  };
}

export * from "./contract-types";
export * from "./contract-extract";
export * from "./contract-extract-cloudflare-pages";
export * from "./contract-extract-cloudflare-containers";
export * from "./contract-extract-app-store-connect";
export * from "./contract-extract-google-play";
export * from "./contract-extract-kubernetes";
export * from "./contract-extract-nixos-shared-host";
export * from "./contract-extract-s3-static";
export * from "./contract-extract-vercel";
export * from "./deployment-targets";
export * from "./deployment-provider-targets";
export * from "./deployment-readiness-gates";
export * from "./external-deployment-requirements";
export * from "./deployment-phase0-release";
