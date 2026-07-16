import assert from "node:assert/strict";
import path from "node:path";
import { resolveRequestedVerifyScope } from "../../dev/verify/requested-scope";

export const changedPaths = (...paths: string[]) => ({ ok: true as const, paths });

export const defaultArgs = {
  coverage: false,
  console: "auto" as const,
  targets: ["//..."],
  selector: "default" as const,
  requestedProjects: [],
  explainSelection: false,
};

export const rootWithoutChangeAuthority = path.join(
  process.cwd(),
  "missing-requested-scope-deployment-git-authority",
);

export function baseDecision(overrides: Record<string, unknown> = {}) {
  return {
    requestedMode: "auto" as const,
    selectorMode: "no-template-impact" as const,
    targets: ["//..."],
    diagnostics: null,
    lintFilters: null,
    reason: "fallback-build-system-scope",
    ...overrides,
  };
}

export async function assertEmptySafetyFloorRejected(): Promise<void> {
  await assert.rejects(
    async () =>
      resolveRequestedVerifyScope({
        root: rootWithoutChangeAuthority,
        invocationCwd: process.cwd(),
        args: defaultArgs,
        env: {},
        deps: {
          resolveTemplateScope: async () => baseDecision(),
          collectChangedPaths: async () => changedPaths("build-tools/deployments/defs.bzl"),
          listDeploymentTargets: async () => ["//projects/deployments/sample/dev:deploy"],
          queryDeploymentDomainTargets: async () => ["//:deployment_domain_labels_cquery"],
          deploymentSafetyFloorTargets: [],
        },
      }),
    /zero deployment safety-floor targets/,
  );
}
