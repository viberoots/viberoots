#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { resolveAllDeployments } from "./deployment-query";

const prerequisiteProviderMaps = new Map<string, Promise<Map<string, string>>>();
const deploymentMaps = new Map<string, Promise<Map<string, DeploymentTarget>>>();

async function resolveWorkspaceDeployments(workspaceRoot: string): Promise<DeploymentTarget[]> {
  try {
    const deployments = await resolveAllDeployments(workspaceRoot);
    if (deployments.length > 0) return deployments;
  } catch {
    // Temp-record admission tests can point workspaceRoot at an isolated record tree.
  }
  return workspaceRoot === process.cwd() ? [] : await resolveAllDeployments(process.cwd());
}

export async function prerequisiteProvidersForWorkspace(workspaceRoot: string) {
  let hit = prerequisiteProviderMaps.get(workspaceRoot);
  if (!hit) {
    hit = resolveWorkspaceDeployments(workspaceRoot)
      .then(
        (deployments) =>
          new Map(deployments.map((deployment) => [deployment.deploymentId, deployment.provider])),
      )
      .catch(() => new Map<string, string>());
    prerequisiteProviderMaps.set(workspaceRoot, hit);
  }
  return await hit;
}

export async function deploymentsForWorkspace(workspaceRoot: string) {
  let hit = deploymentMaps.get(workspaceRoot);
  if (!hit) {
    hit = resolveWorkspaceDeployments(workspaceRoot)
      .then(
        (deployments) =>
          new Map(deployments.map((deployment) => [deployment.deploymentId, deployment])),
      )
      .catch(() => new Map<string, DeploymentTarget>());
    deploymentMaps.set(workspaceRoot, hit);
  }
  return await hit;
}
