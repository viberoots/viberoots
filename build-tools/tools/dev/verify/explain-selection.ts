import { type VerifyScopeDecision } from "./requested-scope";
import { printVerifySelection } from "./selection-output";
import { killBuckIsolation } from "./process-control";
import { resolveVerifyTargetPlan, summarizeVerifyTargetPlan } from "./target-passes";

export async function runExplainSelection(opts: {
  root: string;
  selection: VerifyScopeDecision;
  resolvePlan?: typeof resolveVerifyTargetPlan;
  printSelection?: typeof printVerifySelection;
  killIso?: typeof killBuckIsolation;
}): Promise<void> {
  const iso = "v-explain-selection";
  try {
    const plan = (opts.resolvePlan || resolveVerifyTargetPlan)({
      root: opts.root,
      iso,
      targets: opts.selection.targets,
    });
    (opts.printSelection || printVerifySelection)(opts.selection, summarizeVerifyTargetPlan(plan));
  } finally {
    await (opts.killIso || killBuckIsolation)(opts.root, iso);
  }
}
