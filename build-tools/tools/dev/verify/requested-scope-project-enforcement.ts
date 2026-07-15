import type { VerifyArgs } from "./args";
import {
  injectProjectEnforcementTarget,
  resolveProjectEnforcementSelection,
  type ProjectEnforcementSelectionReason,
} from "./project-enforcement-selection";

export async function withProjectEnforcement<
  T extends { targets: string[]; selectorMode: string },
>(opts: {
  root: string;
  args: VerifyArgs;
  env: NodeJS.ProcessEnv;
  decision: T;
}): Promise<T & { projectEnforcementReason: ProjectEnforcementSelectionReason }> {
  const selection = await resolveProjectEnforcementSelection({
    root: opts.root,
    requestedTargets: opts.args.targets,
    fullSuite: opts.decision.selectorMode === "all-tests",
    env: opts.env,
  });
  return {
    ...opts.decision,
    targets: injectProjectEnforcementTarget(opts.decision.targets, selection),
    projectEnforcementReason: selection.reason,
  };
}
