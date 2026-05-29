import type { VerifyTargetExpansionSummary, VerifyTargetPlan } from "./target-passes";

export function summarizeVerifyTargetPlan(plan: VerifyTargetPlan): VerifyTargetExpansionSummary {
  const isolatedPassCount = plan.passes.filter((pass) => pass.name.startsWith("isolated")).length;
  const isolatedTargetCount = plan.passes
    .filter((pass) => pass.name.startsWith("isolated"))
    .reduce((total, pass) => total + pass.targets.length, 0);
  const resourceLimitedPasses = plan.passes.filter((pass) => pass.name === "resource-limited");
  const resourceLimitedTargetCount = resourceLimitedPasses.reduce(
    (total, pass) => total + pass.targets.length,
    0,
  );
  const sharedTargetCount = plan.passes.find((pass) => pass.name === "shared")?.targets.length ?? 0;
  return {
    expandedTargetCount: plan.targetLabels.length,
    isolatedPassCount,
    isolatedTargetCount,
    resourceLimitedPassCount: resourceLimitedPasses.length,
    resourceLimitedTargetCount,
    sharedTargetCount,
    passCount: plan.passes.length,
  };
}
