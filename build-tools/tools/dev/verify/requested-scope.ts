import { collectChangedPaths } from "../../lib/build-system-test-scope.ts";
import {
  type DeploymentImpactDiagnostics,
  deploymentProjectPrefixesFromLabels,
  resolveDeploymentImpactSelection,
} from "../../lib/deployment-impact-selector.ts";
import { listDeploymentTargets } from "../../deployments/deployment-query.ts";
import {
  DEPLOYMENT_SAFETY_FLOOR_TARGETS,
  queryDeploymentDomainTargets,
} from "../../lib/deployment-test-targets.ts";
import {
  type ProjectImpactSelectorDiagnostics,
  type ProjectImpactSelectorResult,
  resolveProjectImpactSelection,
} from "../../lib/project-impact-selector.ts";
import { toSortedUnique } from "../../lib/project-graph.ts";
import type { VerifyArgs } from "./args.ts";
import { normalizeVerifyTargets } from "./args.ts";
import {
  resolveVerifyTemplateTestScope,
  type VerifyTemplateScopeDecision,
  type VerifySelectionDiagnostics as VerifyTemplateSelectionDiagnostics,
} from "./template-test-scope.ts";

export type VerifyDeploymentScopeMode = "auto" | "always" | "never";

export type DeploymentVerifySelectionDiagnostics = DeploymentImpactDiagnostics & {
  requestedMode: VerifyDeploymentScopeMode;
  deploymentDomainTargets: string[];
  deploymentSafetyFloorTargets: string[];
  projectTargets: string[];
  projectImpactDiagnostics: ProjectImpactSelectorDiagnostics | null;
  selectedTargets: string[];
};

export type VerifyScopeDecision = Omit<
  VerifyTemplateScopeDecision,
  "selectorMode" | "diagnostics"
> & {
  requestedDeploymentMode: VerifyDeploymentScopeMode;
  selectorMode:
    | VerifyTemplateScopeDecision["selectorMode"]
    | "deployment-only"
    | "deployment-and-project-impact";
  diagnostics: VerifyTemplateSelectionDiagnostics | DeploymentVerifySelectionDiagnostics | null;
};

type ResolveRequestedVerifyScopeDeps = {
  resolveTemplateScope: typeof resolveVerifyTemplateTestScope;
  collectChangedPaths: typeof collectChangedPaths;
  listDeploymentTargets: typeof listDeploymentTargets;
  queryDeploymentDomainTargets: typeof queryDeploymentDomainTargets;
  resolveProjectImpactSelection: typeof resolveProjectImpactSelection;
  deploymentSafetyFloorTargets: readonly string[];
};

function parseDeploymentTestScopeMode(raw: string | undefined): VerifyDeploymentScopeMode {
  const v = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (v === "always") return "always";
  if (v === "never") return "never";
  return "auto";
}

function isDefaultVerifyTargetSet(targets: string[]): boolean {
  return targets.length === 1 && targets[0] === "//...";
}

function withDeploymentMode(
  decision: VerifyTemplateScopeDecision,
  requestedDeploymentMode: VerifyDeploymentScopeMode,
): VerifyScopeDecision {
  return {
    ...decision,
    requestedDeploymentMode,
  };
}

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

async function resolveDeploymentOverride(opts: {
  root: string;
  env: NodeJS.ProcessEnv;
  baseDecision: VerifyTemplateScopeDecision;
  requestedDeploymentMode: VerifyDeploymentScopeMode;
  deps?: Partial<ResolveRequestedVerifyScopeDeps>;
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
      "BNX_DEPLOYMENT_TEST_SCOPE=always requires deployment-only changes",
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
    },
    reason:
      impact.mode === "deployment-only"
        ? "deployment-targeted"
        : "deployment-and-project-impact-targeted",
  };
}

export async function resolveRequestedVerifyScope(opts: {
  root: string;
  invocationCwd: string;
  args: VerifyArgs;
  env?: NodeJS.ProcessEnv;
  deps?: Partial<ResolveRequestedVerifyScopeDeps>;
}): Promise<{ args: VerifyArgs; selection: VerifyScopeDecision }> {
  const env = opts.env || process.env;
  const args = {
    ...opts.args,
    targets:
      opts.args.selector === "project-closure"
        ? opts.args.targets
        : await normalizeVerifyTargets({
            workspaceRoot: opts.root,
            baseDir: opts.invocationCwd,
            targets: opts.args.targets,
          }),
  };
  const resolveTemplateScope = opts.deps?.resolveTemplateScope || resolveVerifyTemplateTestScope;
  const baseDecision = await resolveTemplateScope({
    root: opts.root,
    requestedTargets: args.targets,
    requestedSelector:
      args.selector === "project-closure"
        ? { mode: "project-closure", projects: args.requestedProjects }
        : null,
    env,
  });
  const requestedDeploymentMode = parseDeploymentTestScopeMode(env.BNX_DEPLOYMENT_TEST_SCOPE);
  if (args.selector !== "default" || !isDefaultVerifyTargetSet(args.targets)) {
    return {
      args,
      selection: withDeploymentMode(baseDecision, requestedDeploymentMode),
    };
  }
  const deploymentDecision = await resolveDeploymentOverride({
    root: opts.root,
    env,
    baseDecision,
    requestedDeploymentMode,
    deps: opts.deps,
  });
  return {
    args,
    selection: deploymentDecision || withDeploymentMode(baseDecision, requestedDeploymentMode),
  };
}
