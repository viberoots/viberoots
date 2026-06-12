import { collectChangedPaths } from "../../lib/build-system-test-scope";
import {
  type DeploymentImpactDiagnostics,
  deploymentProjectPrefixesFromLabels,
  resolveDeploymentImpactSelection,
} from "../../lib/deployment-impact-selector";
import { listDeploymentTargets } from "../../deployments/deployment-query";
import {
  DEPLOYMENT_SAFETY_FLOOR_TARGETS,
  queryDeploymentDomainTargets,
} from "../../lib/deployment-test-targets";
import {
  type ProjectImpactSelectorDiagnostics,
  type ProjectImpactSelectorResult,
  resolveProjectImpactSelection,
} from "../../lib/project-impact-selector";
import { toSortedUnique } from "../../lib/project-graph";
import type { VerifyTemplateScopeDecision } from "./template-test-scope";
import type {
  DeploymentVerifySelectionDiagnostics,
  VerifyDeploymentScopeMode,
  VerifyScopeDecision,
} from "./requested-scope";

export type ResolveDeploymentVerifyScopeDeps = {
  collectChangedPaths: typeof collectChangedPaths;
  listDeploymentTargets: typeof listDeploymentTargets;
  queryDeploymentDomainTargets: typeof queryDeploymentDomainTargets;
  resolveProjectImpactSelection: typeof resolveProjectImpactSelection;
  deploymentSafetyFloorTargets: readonly string[];
};

function guardDeploymentSelection(
  message: string,
  diagnostics: DeploymentImpactDiagnostics,
  extra: Record<string, unknown> = {},
): never {
  throw new Error(
    [
      `deployment selector guardrail failed: ${message}`,
      "diagnostics:",
      JSON.stringify({ ...diagnostics, ...extra }, null, 2),
    ].join("\n"),
  );
}

function deploymentProjectTargets(
  baseDecision: VerifyTemplateScopeDecision,
  projectImpact: ProjectImpactSelectorResult,
): string[] {
  const baseProjectTargets =
    baseDecision.selectorMode === "project-impact" ||
    baseDecision.selectorMode === "project-closure"
      ? baseDecision.targets
      : [];
  return toSortedUnique([
    ...baseProjectTargets,
    ...(projectImpact.mode === "project-impact" ? projectImpact.targets : []),
  ]);
}

export async function resolveDeploymentOverride(opts: {
  root: string;
  env: NodeJS.ProcessEnv;
  baseDecision: VerifyTemplateScopeDecision;
  requestedDeploymentMode: VerifyDeploymentScopeMode;
  deps?: Partial<ResolveDeploymentVerifyScopeDeps>;
}): Promise<VerifyScopeDecision | null> {
  if (opts.requestedDeploymentMode === "never") return null;

  const collectPaths = opts.deps?.collectChangedPaths || collectChangedPaths;
  const changedPaths = await collectPaths(opts.root, opts.env);
  const resolveDeploymentLabels = opts.deps?.listDeploymentTargets || listDeploymentTargets;
  const deploymentTargetLabels = await resolveDeploymentLabels(opts.root);
  const impact = resolveDeploymentImpactSelection(changedPaths, {
    deploymentTargetLabels,
  });
  if (opts.requestedDeploymentMode === "always" && impact.mode !== "deployment-only") {
    guardDeploymentSelection(
      "VBR_DEPLOYMENT_TEST_SCOPE=always requires deployment-only changes",
      impact.diagnostics,
    );
  }
  if (impact.mode === "mixed-build-system" || impact.mode === "no-deployment-impact") {
    return null;
  }

  const resolveDeploymentTargets =
    opts.deps?.queryDeploymentDomainTargets || queryDeploymentDomainTargets;
  const deploymentDomainTargets = await resolveDeploymentTargets(opts.root);
  if (deploymentDomainTargets.length === 0)
    guardDeploymentSelection("zero resolved deployment-domain test targets", impact.diagnostics);
  const deploymentSafetyFloorTargets = toSortedUnique(
    opts.deps?.deploymentSafetyFloorTargets || DEPLOYMENT_SAFETY_FLOOR_TARGETS,
  );
  if (deploymentSafetyFloorTargets.length === 0)
    guardDeploymentSelection("zero deployment safety-floor targets", impact.diagnostics);

  let projectImpactDiagnostics: ProjectImpactSelectorDiagnostics | null = null;
  let projectTargets: string[] = [];
  if (impact.mode === "deployment-and-project-impact") {
    const resolveProjectImpact =
      opts.deps?.resolveProjectImpactSelection || resolveProjectImpactSelection;
    const deploymentProjectPrefixes = deploymentProjectPrefixesFromLabels(deploymentTargetLabels);
    const projectImpact = await resolveProjectImpact({
      root: opts.root,
      changedPaths,
      projectPrefixes: deploymentProjectPrefixes,
    });
    projectImpactDiagnostics = projectImpact.diagnostics;
    projectTargets = deploymentProjectTargets(opts.baseDecision, projectImpact);
  }

  const selectedTargets = toSortedUnique([
    ...deploymentDomainTargets,
    ...deploymentSafetyFloorTargets,
    ...projectTargets,
  ]);
  return {
    ...opts.baseDecision,
    requestedDeploymentMode: opts.requestedDeploymentMode,
    selectorMode: impact.mode,
    targets: selectedTargets,
    diagnostics: {
      requestedMode: opts.requestedDeploymentMode,
      ...impact.diagnostics,
      deploymentDomainTargets,
      deploymentSafetyFloorTargets,
      projectTargets,
      projectImpactDiagnostics,
      selectedTargets,
    } satisfies DeploymentVerifySelectionDiagnostics,
    reason:
      impact.mode === "deployment-only"
        ? "deployment-targeted"
        : "deployment-and-project-impact-targeted",
  };
}
