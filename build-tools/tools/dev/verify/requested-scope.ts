import fs from "node:fs";
import path from "node:path";
import { collectChangedPaths } from "../../lib/build-system-test-scope";
import { resolveProjectImpactSelection } from "../../lib/project-impact-selector";
import { listDeploymentTargets } from "../../deployments/deployment-query";
import { queryDeploymentDomainTargets } from "../../lib/deployment-test-targets";
import type { VerifyArgs } from "./args";
import { normalizeVerifyTargets } from "./args";
import {
  resolveVerifyTemplateTestScope,
  type VerifyTemplateScopeDecision,
} from "./template-test-scope";
import { allTestsRequested, parseDeploymentTestScopeMode } from "./scope-env";
import {
  resolveDocumentationOverride,
  type ResolveDocumentationVerifyScopeDeps,
} from "./documentation-scope";
import {
  resolveDeploymentOverride,
  type ResolveDeploymentVerifyScopeDeps,
} from "./deployment-scope";
import { resolveWorkspaceRootsSync } from "../../lib/repo";
import { withProjectEnforcement } from "./requested-scope-project-enforcement";
import type { VerifyDeploymentScopeMode, VerifyScopeDecision } from "./requested-scope-types";

export type {
  DeploymentVerifySelectionDiagnostics,
  VerifyDeploymentScopeMode,
  VerifyScopeDecision,
} from "./requested-scope-types";
type ResolveRequestedVerifyScopeDeps = {
  resolveTemplateScope: typeof resolveVerifyTemplateTestScope;
  collectChangedPaths: typeof collectChangedPaths;
  listDeploymentTargets: typeof listDeploymentTargets;
  queryDeploymentDomainTargets: typeof queryDeploymentDomainTargets;
  resolveProjectImpactSelection: typeof resolveProjectImpactSelection;
} & ResolveDocumentationVerifyScopeDeps &
  ResolveDeploymentVerifyScopeDeps;
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
    projectEnforcementReason: "not-required",
  };
}

const INFRASTRUCTURE_CELLS = new Set([
  "root",
  "prelude",
  "toolchains",
  "repo_toolchains",
  "fbsource",
  "fbcode",
  "config",
  "workspace_providers",
  "workspace_buck",
]);

function readBuckconfigCells(root: string): Array<{ name: string; value: string }> {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, ".buckconfig"), "utf8");
  } catch {
    return [];
  }
  const out: Array<{ name: string; value: string }> = [];
  let inCells = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[;#].*$/, "").trim();
    if (!line) continue;
    const section = /^\[([^\]]+)\]$/.exec(line)?.[1]?.trim();
    if (section) {
      inCells = section === "cells";
      continue;
    }
    if (!inCells) continue;
    const match = /^([^=\s]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    out.push({ name: match[1]!.trim(), value: match[2]!.trim() });
  }
  return out;
}

function isLocalTestCell(root: string, cellValue: string): boolean {
  const abs = path.resolve(root, cellValue);
  let real = abs;
  let workspace = path.resolve(root);
  try {
    real = fs.realpathSync.native(abs);
    workspace = fs.realpathSync.native(workspace);
  } catch {
    return false;
  }
  if (real === workspace) return false;
  if (!real.startsWith(workspace + path.sep)) return false;
  const rel = path.relative(workspace, real).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return false;
  if (rel.startsWith(".viberoots/workspace/")) return false;
  return true;
}

export function allTestsTargetsForWorkspace(opts: {
  root: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const root = path.resolve(opts.root);
  const targets = ["//..."];
  const roots = resolveWorkspaceRootsSync({ start: root, env: opts.env || process.env });
  if (roots.sourceMode !== "local") return targets;

  for (const cell of readBuckconfigCells(root)) {
    if (!cell.name || INFRASTRUCTURE_CELLS.has(cell.name)) continue;
    if (!isLocalTestCell(root, cell.value)) continue;
    targets.push(`${cell.name}//...`);
  }
  return Array.from(new Set(targets));
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
  const requestedDeploymentMode = parseDeploymentTestScopeMode(env.VBR_DEPLOYMENT_TEST_SCOPE);
  if (
    args.selector === "default" &&
    isDefaultVerifyTargetSet(args.targets) &&
    allTestsRequested(env)
  ) {
    return {
      args,
      selection: await withProjectEnforcement({
        root: opts.root,
        args,
        env,
        decision: {
          requestedMode: "auto",
          requestedDeploymentMode,
          selectorMode: "all-tests",
          targets: allTestsTargetsForWorkspace({ root: opts.root, env }),
          diagnostics: null,
          lintFilters: null,
          reason: "all-tests-env",
          projectEnforcementReason: "not-required",
        },
      }),
    };
  }
  const changedPathsResult =
    args.selector === "default" && isDefaultVerifyTargetSet(args.targets)
      ? await (opts.deps?.collectChangedPaths || collectChangedPaths)(opts.root, env)
      : undefined;
  const resolveTemplateScope = opts.deps?.resolveTemplateScope || resolveVerifyTemplateTestScope;
  const baseDecision = await resolveTemplateScope({
    root: opts.root,
    requestedTargets: args.targets,
    requestedSelector:
      args.selector === "project-closure"
        ? { mode: "project-closure", projects: args.requestedProjects }
        : null,
    env,
    changedPathsResult,
  });
  if (args.selector !== "default" || !isDefaultVerifyTargetSet(args.targets)) {
    return {
      args,
      selection: await withProjectEnforcement({
        root: opts.root,
        args,
        env,
        decision: withDeploymentMode(baseDecision, requestedDeploymentMode),
        changedPathsResult,
      }),
    };
  }
  const documentationDecision = await resolveDocumentationOverride({
    root: opts.root,
    env,
    baseDecision,
    requestedDeploymentMode,
    deps: opts.deps,
    changedPathsResult,
  });
  if (documentationDecision) {
    return {
      args,
      selection: await withProjectEnforcement({
        root: opts.root,
        args,
        env,
        decision: { ...documentationDecision, projectEnforcementReason: "not-required" },
        changedPathsResult,
      }),
    };
  }
  const deploymentDecision = await resolveDeploymentOverride({
    root: opts.root,
    env,
    baseDecision,
    requestedDeploymentMode,
    deps: opts.deps,
    changedPathsResult,
  });
  const decision = deploymentDecision
    ? { ...deploymentDecision, projectEnforcementReason: "not-required" as const }
    : withDeploymentMode(baseDecision, requestedDeploymentMode);
  return {
    args,
    selection: await withProjectEnforcement({
      root: opts.root,
      args,
      env,
      decision,
      changedPathsResult,
    }),
  };
}
