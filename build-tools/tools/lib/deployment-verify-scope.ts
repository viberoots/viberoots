export const DEPLOYMENT_DOMAIN_LABEL = "domain:deployment";
export const REVIEWED_DEPLOYMENT_TEST_AREA = "build-tools/tools/tests/deployments/";

export const REVIEWED_DEPLOYMENT_OWNED_BUILD_SYSTEM_PREFIXES = [
  "build-tools/deployments/",
  "build-tools/tools/deployments/",
  REVIEWED_DEPLOYMENT_TEST_AREA,
] as const;

export const REVIEWED_SHARED_BUILD_SYSTEM_PREFIXES = [
  "build-tools/tools/buck/",
  "build-tools/tools/dev/",
  "build-tools/tools/lib/",
  "build-tools/lang/",
  "toolchains/",
  "third_party/providers/",
  "prelude/",
] as const;

export const REVIEWED_SHARED_BUILD_SYSTEM_PATHS = [
  ".buckconfig",
  "BUCK",
  "TARGETS",
  "flake.lock",
  "flake.nix",
] as const;

function normalizeRepoPath(relPath: string): string {
  return String(relPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function matchesPrefix(relPath: string, prefixes: readonly string[]): boolean {
  const p = normalizeRepoPath(relPath);
  return prefixes.some((prefix) => p.startsWith(prefix));
}

export function isReviewedDeploymentOwnedTestPath(relPath: string): boolean {
  return matchesPrefix(relPath, [REVIEWED_DEPLOYMENT_TEST_AREA]);
}

export function isReviewedDeploymentOwnedBuildSystemPath(relPath: string): boolean {
  return matchesPrefix(relPath, REVIEWED_DEPLOYMENT_OWNED_BUILD_SYSTEM_PREFIXES);
}

export function isReviewedSharedBuildSystemPath(relPath: string): boolean {
  const p = normalizeRepoPath(relPath);
  if (
    REVIEWED_SHARED_BUILD_SYSTEM_PATHS.includes(
      p as (typeof REVIEWED_SHARED_BUILD_SYSTEM_PATHS)[number],
    )
  ) {
    return true;
  }
  return matchesPrefix(p, REVIEWED_SHARED_BUILD_SYSTEM_PREFIXES);
}

export function classifyReviewedBuildSystemVerifyPath(
  relPath: string,
): "deployment-owned" | "shared" | "unclassified" {
  if (isReviewedDeploymentOwnedBuildSystemPath(relPath)) {
    return "deployment-owned";
  }
  if (isReviewedSharedBuildSystemPath(relPath)) {
    return "shared";
  }
  return "unclassified";
}
