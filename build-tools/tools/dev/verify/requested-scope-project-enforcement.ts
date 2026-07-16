import type { VerifyArgs } from "./args";
import type { ChangedPathsResult } from "../../lib/build-system-test-scope";
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
  changedPathsResult?: ChangedPathsResult;
}): Promise<
  T & {
    projectEnforcementReason: ProjectEnforcementSelectionReason;
    projectEnforcementChangeAuthorityFailure?: string;
  }
> {
  const selection = await resolveProjectEnforcementSelection({
    root: opts.root,
    requestedTargets: opts.args.targets,
    fullSuite: opts.decision.selectorMode === "all-tests",
    env: opts.env,
    changedPathsResult: opts.changedPathsResult,
  });
  return {
    ...opts.decision,
    targets: injectProjectEnforcementTarget(opts.decision.targets, selection),
    projectEnforcementReason: selection.reason,
    ...(selection.changeAuthorityFailure
      ? { projectEnforcementChangeAuthorityFailure: selection.changeAuthorityFailure }
      : {}),
  };
}
