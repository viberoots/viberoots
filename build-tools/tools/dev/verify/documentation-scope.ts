import { collectChangedPaths, type ChangedPathsResult } from "../../lib/build-system-test-scope";
import {
  DEPLOYMENT_DOC_CONTRACT_TARGETS,
  resolveDocumentationImpactSelection,
} from "../../lib/documentation-impact-selector";
import type { VerifyTemplateScopeDecision } from "./template-test-scope";
import type { VerifyDeploymentScopeMode, VerifyScopeDecision } from "./requested-scope";

export type ResolveDocumentationVerifyScopeDeps = {
  collectChangedPaths: typeof collectChangedPaths;
  deploymentDocContractTargets: readonly string[];
};

export async function resolveDocumentationOverride(opts: {
  root: string;
  env: NodeJS.ProcessEnv;
  baseDecision: VerifyTemplateScopeDecision;
  requestedDeploymentMode: VerifyDeploymentScopeMode;
  deps?: Partial<ResolveDocumentationVerifyScopeDeps>;
  changedPathsResult?: ChangedPathsResult;
}): Promise<VerifyScopeDecision | null> {
  if (opts.requestedDeploymentMode === "never") return null;
  const collectPaths = opts.deps?.collectChangedPaths || collectChangedPaths;
  const changedPathsResult = opts.changedPathsResult || (await collectPaths(opts.root, opts.env));
  if (!changedPathsResult.ok) return null;
  const changedPaths = changedPathsResult.paths;
  const selected = resolveDocumentationImpactSelection(changedPaths, {
    deploymentDocContractTargets:
      opts.deps?.deploymentDocContractTargets || DEPLOYMENT_DOC_CONTRACT_TARGETS,
  });
  if (selected.mode !== "documentation-contract") return null;
  return {
    ...opts.baseDecision,
    requestedDeploymentMode: opts.requestedDeploymentMode,
    selectorMode: "documentation-contract",
    targets: selected.targets,
    diagnostics: selected.diagnostics,
    lintFilters: ["."],
    reason: "documentation-contract-targeted",
  };
}
