#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels.ts";
import { type DeploymentTarget, isCloudflarePagesDeployment } from "./contract.ts";
import { resolveAllDeployments } from "./deployment-query.ts";

export const DEPLOY_LIST_SCHEMA = "deploy-list@1";
export const DEPLOY_VALIDATE_SCHEMA = "deploy-validate@1";

export function printDeployJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function requireProviderNativeConfig(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<void> {
  if (!isCloudflarePagesDeployment(deployment)) return;
  const configPath = path.join(
    workspaceRoot,
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
  await fsp.access(configPath).catch(() => {
    throw new Error(
      `cloudflare-pages provider config not found for ${deployment.label}: ${deployment.publisher.config}`,
    );
  });
}

function listEntry(deployment: DeploymentTarget) {
  return {
    deploymentId: deployment.deploymentId,
    label: deployment.label,
    provider: deployment.provider,
    protectionClass: deployment.protectionClass,
    environmentStage: deployment.environmentStage,
    providerTargetIdentity:
      deployment.provider === "nixos-shared-host"
        ? deployment.providerTarget.deploymentTargetIdentity
        : deployment.providerTarget.providerTargetIdentity,
    ...(deployment.preview ? { previewIdentitySelector: deployment.preview.identitySelector } : {}),
  };
}

export async function listDeploymentsForCli(workspaceRoot: string) {
  const deployments = await resolveAllDeployments(workspaceRoot);
  return {
    schemaVersion: DEPLOY_LIST_SCHEMA,
    deployments: deployments.map(listEntry),
  };
}

export async function validateDeploymentForCli(
  workspaceRoot: string,
  deployment: DeploymentTarget,
) {
  await requireProviderNativeConfig(workspaceRoot, deployment);
  return {
    schemaVersion: DEPLOY_VALIDATE_SCHEMA,
    valid: true,
    deployment: listEntry(deployment),
  };
}
