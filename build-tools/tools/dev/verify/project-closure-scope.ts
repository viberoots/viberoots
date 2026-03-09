import type { ProjectClosureSelectorResult } from "../../lib/project-closure-selector.ts";
import type { BuildSystemTestMode } from "../../lib/build-system-test-scope.ts";
import type {
  VerifyTemplateScopeDecision,
  VerifyTemplateScopeMode,
} from "./template-test-scope.ts";

type RequestedSelector = { mode: "project-closure"; projects: string[] } | null | undefined;
type BuildScope = {
  targets: string[];
  mode: BuildSystemTestMode;
  hasBuildSystemChanges: boolean;
};

function isDefaultVerifyTargetSet(targets: string[]): boolean {
  return targets.length === 1 && targets[0] === "//...";
}

export async function resolveProjectClosureVerifyScope(opts: {
  root: string;
  requestedMode: VerifyTemplateScopeMode;
  requestedTargets: string[];
  requestedSelector: RequestedSelector;
  baseScope: BuildScope;
  resolveProjectClosure: (opts: {
    root: string;
    requestedProjects: string[];
  }) => Promise<ProjectClosureSelectorResult>;
}): Promise<VerifyTemplateScopeDecision | null> {
  if (opts.requestedSelector?.mode !== "project-closure") return null;
  if (!isDefaultVerifyTargetSet(opts.requestedTargets)) {
    throw new Error(
      "verify selector 'project-closure' cannot be combined with explicit Buck targets",
    );
  }
  const selected = await opts.resolveProjectClosure({
    root: opts.root,
    requestedProjects: opts.requestedSelector.projects,
  });
  const shouldBroaden = opts.baseScope.hasBuildSystemChanges || opts.baseScope.mode === "always";
  if (!shouldBroaden) {
    return {
      requestedMode: opts.requestedMode,
      selectorMode: "project-closure",
      targets: selected.targets,
      diagnostics: selected.diagnostics,
      lintFilters: selected.diagnostics.resolvedDependencyClosure.map((project) => `./${project}`),
      reason: "project-closure-targeted",
    };
  }
  return {
    requestedMode: opts.requestedMode,
    selectorMode: "project-closure",
    targets: opts.baseScope.targets,
    diagnostics: {
      ...selected.diagnostics,
      selectedTargets: opts.baseScope.targets,
      fallbackReason: opts.baseScope.hasBuildSystemChanges
        ? "build-system-changes"
        : "build-system-tests-always",
    },
    lintFilters: null,
    reason: "fallback-build-system-scope",
  };
}
