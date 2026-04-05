#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";

function toSortedUnique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean))).sort();
}

export function prerequisiteDeploymentIds(deployment: DeploymentTarget): string[] {
  return toSortedUnique(deployment.prerequisites.map((prerequisite) => prerequisite.deploymentId));
}

export function resolveDirectPrerequisiteDependents(
  directDeploymentIds: string[],
  deployments: DeploymentTarget[],
): string[] {
  const direct = new Set(directDeploymentIds);
  return deployments
    .filter(
      (deployment) =>
        !direct.has(deployment.deploymentId) &&
        deployment.prerequisites.some((prerequisite) => direct.has(prerequisite.deploymentId)),
    )
    .map((deployment) => deployment.deploymentId)
    .sort();
}

export function sortDeploymentsTopologically(deployments: DeploymentTarget[]): DeploymentTarget[] {
  const byId = new Map(deployments.map((deployment) => [deployment.deploymentId, deployment]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const deployment of deployments) {
    indegree.set(deployment.deploymentId, 0);
    dependents.set(deployment.deploymentId, []);
  }

  for (const deployment of deployments) {
    for (const prerequisiteId of prerequisiteDeploymentIds(deployment)) {
      if (!byId.has(prerequisiteId)) continue;
      indegree.set(deployment.deploymentId, (indegree.get(deployment.deploymentId) || 0) + 1);
      dependents.set(prerequisiteId, [
        ...(dependents.get(prerequisiteId) || []),
        deployment.deploymentId,
      ]);
    }
  }

  const ready = deployments
    .filter((deployment) => (indegree.get(deployment.deploymentId) || 0) === 0)
    .map((deployment) => deployment.deploymentId)
    .sort((a, b) => byId.get(a)!.label.localeCompare(byId.get(b)!.label));
  const ordered: DeploymentTarget[] = [];

  while (ready.length > 0) {
    const nextId = ready.shift()!;
    ordered.push(byId.get(nextId)!);
    const nextDependents = [...(dependents.get(nextId) || [])].sort((a, b) =>
      byId.get(a)!.label.localeCompare(byId.get(b)!.label),
    );
    for (const dependentId of nextDependents) {
      const remaining = (indegree.get(dependentId) || 0) - 1;
      indegree.set(dependentId, remaining);
      if (remaining === 0) {
        ready.push(dependentId);
        ready.sort((a, b) => byId.get(a)!.label.localeCompare(byId.get(b)!.label));
      }
    }
  }

  if (ordered.length !== deployments.length) {
    throw new Error("deployment prerequisite graph must be acyclic before orchestration");
  }
  return ordered;
}
