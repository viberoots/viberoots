import { isBuildSystemPath, isIgnoredBuildSystemScopePath } from "./build-system-test-scope.ts";
import { classifyReviewedBuildSystemVerifyPath } from "./deployment-verify-scope.ts";
import { normalizeRepoPath, projectFromRepoPath, toSortedUnique } from "./project-graph.ts";

export type DeploymentImpactMode =
  | "deployment-only"
  | "deployment-and-project-impact"
  | "mixed-build-system"
  | "no-deployment-impact";

export type DeploymentImpactDiagnostics = {
  mode: DeploymentImpactMode;
  changedPaths: string[];
  deploymentOwnedPaths: string[];
  deploymentProjectPaths: string[];
  deploymentProjects: string[];
  sharedBuildSystemPaths: string[];
  unknownBuildSystemPaths: string[];
  fullBuildSystemTriggerPaths: string[];
  reason: string;
};

export type DeploymentImpactResult = {
  mode: DeploymentImpactMode;
  diagnostics: DeploymentImpactDiagnostics;
};

const DEPLOYMENT_PROJECT_PREFIXES = ["projects/deployments"] as const;

function normalizeChangedPaths(changedPaths: string[]): string[] {
  return toSortedUnique(
    changedPaths
      .map((relPath) =>
        normalizeRepoPath(relPath)
          .replace(/^\.\/+/, "")
          .replace(/^\/+/, ""),
      )
      .filter(Boolean),
  );
}

function collectDeploymentProjects(paths: string[]): string[] {
  return toSortedUnique(
    paths
      .map((relPath) => projectFromRepoPath(relPath, DEPLOYMENT_PROJECT_PREFIXES))
      .filter((project): project is string => !!project),
  );
}

export function isDeploymentProjectPath(relPath: string): boolean {
  return projectFromRepoPath(relPath, DEPLOYMENT_PROJECT_PREFIXES) !== null;
}

function mixedBuildSystemReason(diagnostics: {
  sharedBuildSystemPaths: string[];
  unknownBuildSystemPaths: string[];
}): string {
  if (diagnostics.unknownBuildSystemPaths.length > 0) {
    return "unknown-build-system-path-changed";
  }
  return "shared-build-system-path-changed";
}

export function resolveDeploymentImpactSelection(changedPaths: string[]): DeploymentImpactResult {
  const normalizedChangedPaths = normalizeChangedPaths(changedPaths);
  const deploymentOwnedPaths: string[] = [];
  const deploymentProjectPaths: string[] = [];
  const sharedBuildSystemPaths: string[] = [];
  const unknownBuildSystemPaths: string[] = [];

  for (const relPath of normalizedChangedPaths) {
    if (isIgnoredBuildSystemScopePath(relPath)) {
      continue;
    }
    if (classifyReviewedBuildSystemVerifyPath(relPath) === "deployment-owned") {
      deploymentOwnedPaths.push(relPath);
      continue;
    }
    if (isDeploymentProjectPath(relPath)) {
      deploymentProjectPaths.push(relPath);
      continue;
    }
    if (!isBuildSystemPath(relPath)) {
      continue;
    }
    if (classifyReviewedBuildSystemVerifyPath(relPath) === "shared") {
      sharedBuildSystemPaths.push(relPath);
      continue;
    }
    unknownBuildSystemPaths.push(relPath);
  }

  const deploymentProjects = collectDeploymentProjects(deploymentProjectPaths);
  const fullBuildSystemTriggerPaths = toSortedUnique([
    ...sharedBuildSystemPaths,
    ...unknownBuildSystemPaths,
  ]);

  const baseDiagnostics = {
    changedPaths: normalizedChangedPaths,
    deploymentOwnedPaths: toSortedUnique(deploymentOwnedPaths),
    deploymentProjectPaths: toSortedUnique(deploymentProjectPaths),
    deploymentProjects,
    sharedBuildSystemPaths: toSortedUnique(sharedBuildSystemPaths),
    unknownBuildSystemPaths: toSortedUnique(unknownBuildSystemPaths),
    fullBuildSystemTriggerPaths,
  };

  if (fullBuildSystemTriggerPaths.length > 0) {
    const reason = mixedBuildSystemReason(baseDiagnostics);
    return {
      mode: "mixed-build-system",
      diagnostics: {
        mode: "mixed-build-system",
        ...baseDiagnostics,
        reason,
      },
    };
  }

  if (deploymentProjectPaths.length > 0) {
    return {
      mode: "deployment-and-project-impact",
      diagnostics: {
        mode: "deployment-and-project-impact",
        ...baseDiagnostics,
        reason: "deployment-project-path-changed",
      },
    };
  }

  if (deploymentOwnedPaths.length > 0) {
    return {
      mode: "deployment-only",
      diagnostics: {
        mode: "deployment-only",
        ...baseDiagnostics,
        reason: "deployment-owned-build-system-path-changed",
      },
    };
  }

  return {
    mode: "no-deployment-impact",
    diagnostics: {
      mode: "no-deployment-impact",
      ...baseDiagnostics,
      reason: "no-deployment-impact",
    },
  };
}
