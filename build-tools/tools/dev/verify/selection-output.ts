import process from "node:process";
import type { VerifyScopeDecision } from "./requested-scope.ts";
import type { VerifyTargetExpansionSummary } from "./target-passes.ts";

export function printVerifySelection(
  decision: VerifyScopeDecision,
  expanded?: VerifyTargetExpansionSummary,
): void {
  process.stdout.write(`[verify] selection: ${summarizeVerifyScopeDecision(decision)}\n`);
  if (expanded) {
    process.stdout.write(
      `[verify] expanded selection: concreteTargets=${expanded.expandedTargetCount} passCount=${expanded.passCount} isolatedPasses=${expanded.isolatedPassCount} isolatedTargets=${expanded.isolatedTargetCount} resourceLimitedPasses=${expanded.resourceLimitedPassCount} resourceLimitedTargets=${expanded.resourceLimitedTargetCount} sharedTargets=${expanded.sharedTargetCount}\n`,
    );
  }
  if (decision.diagnostics) {
    process.stdout.write(`${JSON.stringify(decision.diagnostics, null, 2)}\n`);
  }
}

export function summarizeVerifyScopeDecision(d: VerifyScopeDecision): string {
  const base = `templateRequested=${d.requestedMode} deploymentRequested=${d.requestedDeploymentMode} selector=${d.selectorMode} reason=${d.reason}`;
  if (!d.diagnostics) return `${base} targetSelectors=${d.targets.length}`;
  if ("deploymentDomainTargets" in d.diagnostics) {
    return `${base} deploymentTargets=${d.diagnostics.deploymentDomainTargets.length} projectTargets=${d.diagnostics.projectTargets.length} targetSelectors=${d.targets.length}`;
  }
  if ("requestedProjects" in d.diagnostics) {
    return `${base} requestedProjectCount=${d.diagnostics.requestedProjects.length} closureProjectCount=${d.diagnostics.resolvedDependencyClosure.length} targetSelectors=${d.targets.length}`;
  }
  if ("changedProjects" in d.diagnostics) {
    return `${base} changedProjects=${d.diagnostics.changedProjects.join(",") || "none"} dependentProjects=${d.diagnostics.dependentProjects.join(",") || "none"} targetSelectors=${d.targets.length}`;
  }
  return `${base} templates=${d.diagnostics.changedTemplateIds.join(",") || "none"} targetSelectors=${d.targets.length}`;
}
