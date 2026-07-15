import { type VerifyScopeDecision } from "./requested-scope";
import { printVerifySelection } from "./selection-output";
import { killBuckIsolation } from "./process-control";
import { resolveVerifyTargetPlan, summarizeVerifyTargetPlan } from "./target-passes";
import { registerBuckIsolationSync } from "./owned-process-state";
import type { VerifyExecutionPolicy } from "./remote-policy";

export async function runExplainSelection(opts: {
  root: string;
  selection: VerifyScopeDecision;
  executionPolicy: VerifyExecutionPolicy;
  resolvePlan?: typeof resolveVerifyTargetPlan;
  printSelection?: typeof printVerifySelection;
  killIso?: typeof killBuckIsolation;
}): Promise<void> {
  const iso = "v-explain-selection";
  const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (stateFile) {
    registerBuckIsolationSync({
      stateFile,
      iso,
      repoRoot: opts.root,
      ownerPid: process.pid,
      kind: "verify-explain-selection",
    });
  }
  try {
    const plan = await (opts.resolvePlan || resolveVerifyTargetPlan)({
      root: opts.root,
      iso,
      targets: opts.selection.targets,
      executionPolicy: opts.executionPolicy,
    });
    (opts.printSelection || printVerifySelection)(opts.selection, summarizeVerifyTargetPlan(plan));
  } finally {
    await (opts.killIso || killBuckIsolation)(opts.root, iso);
  }
}
