#!/usr/bin/env zx-wrapper
import { hasRelevantBuildSystemChanges } from "../lib/build-system-test-scope.ts";
import { packagePathFromLabel } from "../lib/labels.ts";
import { resolveProjectImpactSelection } from "../lib/project-impact-selector.ts";
import {
  normalizeRepoPath,
  projectFromRepoPath,
  projectFromTargetLabel,
  toSortedUnique,
} from "../lib/project-graph.ts";
import { componentTargetsFor, type DeploymentTarget } from "./contract.ts";
import {
  ownedComponentProjectPrefixes,
  ownedDeploymentPrefixes,
  ownedWorkspaceRoots,
} from "./deployment-from-changes-owned-paths.ts";
import {
  resolveDirectPrerequisiteDependents,
  sortDeploymentsTopologically,
} from "./deployment-prerequisites.ts";

export type DeploymentChangeReason =
  | { kind: "broad-change"; paths: string[] }
  | { kind: "deployment-path"; paths: string[] }
  | { kind: "component-project"; paths: string[]; projects: string[] }
  | { kind: "prerequisite-widening"; deploymentIds: string[] };

export type DeploymentFromChangesPlan = {
  changedPaths: string[];
  directDeploymentIds: string[];
  selectedDeployments: DeploymentTarget[];
  reasonsByDeploymentId: Record<string, DeploymentChangeReason[]>;
};

function cleanChangedPath(changedPath: string): string {
  return normalizeRepoPath(changedPath)
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function deploymentPackagePaths(deployments: DeploymentTarget[]): Map<string, string[]> {
  const packages = new Map<string, string[]>();
  for (const deployment of deployments) {
    const packagePath = packagePathFromLabel(deployment.label);
    const deploymentIds = packages.get(packagePath) || [];
    deploymentIds.push(deployment.deploymentId);
    packages.set(packagePath, deploymentIds);
  }
  return packages;
}

function addReason(
  reasonsByDeploymentId: Map<string, DeploymentChangeReason[]>,
  deploymentId: string,
  reason: DeploymentChangeReason,
) {
  const reasons = reasonsByDeploymentId.get(deploymentId) || [];
  reasons.push(reason);
  reasonsByDeploymentId.set(deploymentId, reasons);
}

function addReasonForDeployments(
  reasonsByDeploymentId: Map<string, DeploymentChangeReason[]>,
  deploymentIds: Iterable<string>,
  reason: DeploymentChangeReason,
) {
  for (const deploymentId of deploymentIds) {
    addReason(reasonsByDeploymentId, deploymentId, reason);
  }
}

function directDeploymentIdsFromPaths(
  changedPaths: string[],
  deployments: DeploymentTarget[],
): string[] {
  const packages = deploymentPackagePaths(deployments);
  return toSortedUnique(
    changedPaths.flatMap((changedPath) => {
      const normalized = cleanChangedPath(changedPath);
      return Array.from(packages.entries()).flatMap(([packagePath, deploymentIds]) =>
        normalized === `${packagePath}/TARGETS` || normalized.startsWith(`${packagePath}/`)
          ? deploymentIds
          : [],
      );
    }),
  );
}

function hasBroadProjectChangeInOwnedRoots(
  changedPaths: string[],
  componentProjectPrefixes: string[],
  deploymentPrefixes: string[],
): boolean {
  const workspaceRoots = ownedWorkspaceRoots(componentProjectPrefixes, deploymentPrefixes);
  return changedPaths.some((changedPath) => {
    const normalized = cleanChangedPath(changedPath);
    if (!workspaceRoots.some((root) => normalized.startsWith(root))) return false;
    if (deploymentPrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
    return !projectFromRepoPath(normalized, componentProjectPrefixes);
  });
}

function hasUnmatchedDeploymentPath(
  changedPaths: string[],
  deploymentPrefixes: string[],
  deployments: DeploymentTarget[],
): boolean {
  const packages = Array.from(deploymentPackagePaths(deployments).keys());
  return changedPaths.some((changedPath) => {
    const normalized = cleanChangedPath(changedPath);
    if (!deploymentPrefixes.some((prefix) => normalized.startsWith(prefix))) return false;
    return !packages.some(
      (packagePath) =>
        normalized === `${packagePath}/TARGETS` || normalized.startsWith(`${packagePath}/`),
    );
  });
}

function componentImpactedDeploymentIds(
  deployments: DeploymentTarget[],
  projectIds: string[],
  projectPrefixes: string[],
): string[] {
  const impactedProjects = new Set(projectIds);
  return deployments
    .filter((deployment) =>
      componentTargetsFor(deployment).some((target) =>
        impactedProjects.has(projectFromTargetLabel(target, projectPrefixes) || ""),
      ),
    )
    .map((deployment) => deployment.deploymentId)
    .sort();
}

export async function resolveDeploymentsFromChanges(opts: {
  workspaceRoot: string;
  changedPaths: string[];
  deployments: DeploymentTarget[];
}): Promise<DeploymentFromChangesPlan> {
  const changedPaths = toSortedUnique(opts.changedPaths.map((path) => cleanChangedPath(path)));
  const componentProjectPrefixes = ownedComponentProjectPrefixes(opts.deployments);
  const deploymentPrefixes = ownedDeploymentPrefixes(opts.deployments);
  const workspaceRoots = ownedWorkspaceRoots(componentProjectPrefixes, deploymentPrefixes);
  const reasonsByDeploymentId = new Map<string, DeploymentChangeReason[]>();
  const directDeploymentIds = new Set<string>();
  const broadChangePaths = changedPaths.filter((changedPath) =>
    hasRelevantBuildSystemChanges([changedPath]),
  );

  if (
    broadChangePaths.length > 0 ||
    hasBroadProjectChangeInOwnedRoots(changedPaths, componentProjectPrefixes, deploymentPrefixes) ||
    hasUnmatchedDeploymentPath(changedPaths, deploymentPrefixes, opts.deployments)
  ) {
    const paths =
      broadChangePaths.length > 0
        ? broadChangePaths
        : changedPaths.filter((changedPath) =>
            workspaceRoots.some((root) => normalizeRepoPath(changedPath).startsWith(root)),
          );
    addReasonForDeployments(
      reasonsByDeploymentId,
      opts.deployments.map((deployment) => deployment.deploymentId),
      { kind: "broad-change", paths },
    );
    for (const deployment of opts.deployments) directDeploymentIds.add(deployment.deploymentId);
  } else {
    const deploymentPathIds = directDeploymentIdsFromPaths(changedPaths, opts.deployments);
    addReasonForDeployments(reasonsByDeploymentId, deploymentPathIds, {
      kind: "deployment-path",
      paths: changedPaths.filter((changedPath) =>
        deploymentPrefixes.some((prefix) => normalizeRepoPath(changedPath).startsWith(prefix)),
      ),
    });
    for (const deploymentId of deploymentPathIds) directDeploymentIds.add(deploymentId);

    const projectImpact = await resolveProjectImpactSelection({
      root: opts.workspaceRoot,
      changedPaths,
      projectPrefixes: componentProjectPrefixes,
    });
    if (
      projectImpact.mode === "fallback-build-system-scope" &&
      projectImpact.diagnostics.changedProjects.length > 0
    ) {
      addReasonForDeployments(
        reasonsByDeploymentId,
        opts.deployments.map((deployment) => deployment.deploymentId),
        { kind: "broad-change", paths: changedPaths },
      );
      for (const deployment of opts.deployments) {
        directDeploymentIds.add(deployment.deploymentId);
      }
    } else if (projectImpact.mode === "project-impact") {
      const projectIds = [
        ...projectImpact.diagnostics.changedProjects,
        ...projectImpact.diagnostics.dependentProjects,
      ];
      const impacted = componentImpactedDeploymentIds(
        opts.deployments,
        projectIds,
        componentProjectPrefixes,
      );
      addReasonForDeployments(reasonsByDeploymentId, impacted, {
        kind: "component-project",
        paths: changedPaths,
        projects: toSortedUnique(projectIds),
      });
      for (const deploymentId of impacted) directDeploymentIds.add(deploymentId);
    }
  }

  const widenedIds = resolveDirectPrerequisiteDependents(
    Array.from(directDeploymentIds),
    opts.deployments,
  );
  for (const widenedId of widenedIds) {
    if (directDeploymentIds.has(widenedId)) continue;
    addReason(reasonsByDeploymentId, widenedId, {
      kind: "prerequisite-widening",
      deploymentIds: Array.from(directDeploymentIds).sort(),
    });
  }

  const selectedIds = new Set<string>([...directDeploymentIds, ...widenedIds]);
  const selectedDeployments = sortDeploymentsTopologically(
    opts.deployments.filter((deployment) => selectedIds.has(deployment.deploymentId)),
  );
  const laneRefs = toSortedUnique(
    selectedDeployments.map((deployment) => deployment.lanePolicyRef),
  );
  if (laneRefs.length > 1) {
    throw new Error(
      `--from-changes selected deployments across multiple lanes: ${laneRefs.join(", ")}`,
    );
  }
  return {
    changedPaths,
    directDeploymentIds: Array.from(directDeploymentIds).sort(),
    selectedDeployments,
    reasonsByDeploymentId: Object.fromEntries(reasonsByDeploymentId),
  };
}
