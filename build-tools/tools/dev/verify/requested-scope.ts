import type { VerifyArgs } from "./args.ts";
import type { VerifyTargetExpansionSummary } from "./target-passes.ts";
import { normalizeVerifyTargets } from "./args.ts";
import {
  resolveVerifyTemplateTestScope,
  summarizeTemplateScopeDecision,
  type VerifyTemplateScopeDecision,
} from "./template-test-scope.ts";

export async function resolveRequestedVerifyScope(opts: {
  root: string;
  invocationCwd: string;
  args: VerifyArgs;
}): Promise<{ args: VerifyArgs; templateScope: VerifyTemplateScopeDecision }> {
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
  const templateScope = await resolveVerifyTemplateTestScope({
    root: opts.root,
    requestedTargets: args.targets,
    requestedSelector:
      args.selector === "project-closure"
        ? { mode: "project-closure", projects: args.requestedProjects }
        : null,
  });
  return { args, templateScope };
}

export function printVerifySelection(
  decision: VerifyTemplateScopeDecision,
  expanded?: VerifyTargetExpansionSummary,
): void {
  process.stdout.write(`[verify] selection: ${summarizeTemplateScopeDecision(decision)}\n`);
  if (expanded) {
    process.stdout.write(
      `[verify] expanded selection: concreteTargets=${expanded.expandedTargetCount} passCount=${expanded.passCount} isolatedPasses=${expanded.isolatedPassCount} isolatedTargets=${expanded.isolatedTargetCount} sharedTargets=${expanded.sharedTargetCount}\n`,
    );
  }
  if (decision.diagnostics) {
    process.stdout.write(`${JSON.stringify(decision.diagnostics, null, 2)}\n`);
  }
}
