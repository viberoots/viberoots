#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels.ts";
import { providerTargetIdentityFor, type DeploymentTarget } from "./contract.ts";
import { validateRepoFrontDoorDeployment } from "./deploy-front-door-validate.ts";
import { resolveAllDeployments } from "./deployment-query.ts";

export const DEPLOY_LIST_SCHEMA = "deploy-list@1";
export const DEPLOY_VALIDATE_SCHEMA = "deploy-validate@1";

export function printDeployJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function printProviderTargetIdentityForCli(deployment: DeploymentTarget) {
  console.log(providerTargetIdentityFor(deployment));
}

async function requireProviderNativeConfig(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<void> {
  if (!("config" in deployment.publisher)) return;
  const configPath = path.join(
    workspaceRoot,
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
  await fsp.access(configPath).catch(() => {
    throw new Error(
      `${deployment.provider} provider config not found for ${deployment.label}: ${deployment.publisher.config}`,
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
    providerTargetIdentity: providerTargetIdentityFor(deployment),
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
  await validateRepoFrontDoorDeployment(workspaceRoot, deployment);
  return {
    schemaVersion: DEPLOY_VALIDATE_SCHEMA,
    valid: true,
    deployment: listEntry(deployment),
  };
}
