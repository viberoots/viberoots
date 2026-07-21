import process from "node:process";
import { normalizeTargetLabel } from "../../lib/labels";
import { ensureWorkspaceBuckStatePackage } from "../../lib/workspace-buck-state";
import { admitVerifyRemoteTargets } from "./remote-target-policy";
import type { VerifyExecutionPolicy } from "./remote-policy";
import { isVerifyTargetScan, loadVerifyTargetLabels } from "./target-label-query";
export {
  buildCqueryQuery,
  isBroadVerifyTargetScan,
  isVerifyTargetScan,
  loadVerifyTargetLabels,
  normalizeVerifyTargetLabel,
} from "./target-label-query";

export const VERIFY_ISOLATED_LABEL = "verify:isolated";
export const VERIFY_BOUNDED_ISOLATED_LABEL = "verify:isolated-bounded";
export const VERIFY_BOUNDED_ISOLATED_THREADS = 2;
export const VERIFY_ENFORCEMENT_LABEL = "verify:enforcement";
export const VERIFY_PROJECT_ENFORCEMENT_LABEL = "verify:project-enforcement";
export const VERIFY_MANUAL_LABEL = "verify:manual";
export const VERIFY_RESOURCE_LIMITED_LABEL = "verify:resource-limited";
export const VERIFY_RESOURCE_LIMITED_THREADS = 4;
export const VERIFY_BROAD_RESOURCE_LIMITED_THREADS = 2;
export const VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN = 50;

export type VerifyTargetLabels = {
  target: string;
  labels: readonly string[];
};

export type VerifyTargetPass = {
  name: string;
  targets: string[];
  threadsOverride?: number;
};

export type VerifyTargetExpansionSummary = {
  expandedTargetCount: number;
  isolatedPassCount: number;
  isolatedTargetCount: number;
  resourceLimitedPassCount: number;
  resourceLimitedTargetCount: number;
  sharedTargetCount: number;
  passCount: number;
};

export type VerifyTargetPlan = {
  targetLabels: VerifyTargetLabels[];
  passes: VerifyTargetPass[];
};
export { summarizeVerifyTargetPlan } from "./target-plan-summary";

type IsolatedPassMode = "batch" | "per-target";

function isolatedPassMode(env: NodeJS.ProcessEnv = process.env): IsolatedPassMode {
  return String(env.VBR_VERIFY_ISOLATED_PASS_MODE || "").trim() === "per-target"
    ? "per-target"
    : "batch";
}

export function planVerifyTargetPasses(
  targets: readonly VerifyTargetLabels[],
  opts?: { isolatedMode?: IsolatedPassMode },
): VerifyTargetPass[] {
  const sharedTargets: string[] = [];
  const isolatedTargets: string[] = [];
  const boundedIsolatedTargets: string[] = [];
  const enforcementTargets: string[] = [];
  const projectEnforcementTargets: string[] = [];
  const resourceLimitedTargets: string[] = [];

  for (const entry of targets) {
    if (entry.labels.includes(VERIFY_PROJECT_ENFORCEMENT_LABEL)) {
      const conflicts = [
        VERIFY_ENFORCEMENT_LABEL,
        VERIFY_ISOLATED_LABEL,
        VERIFY_BOUNDED_ISOLATED_LABEL,
        VERIFY_RESOURCE_LIMITED_LABEL,
        VERIFY_MANUAL_LABEL,
      ].filter((label) => entry.labels.includes(label));
      if (conflicts.length > 0) {
        throw new Error(
          `${entry.target} combines ${VERIFY_PROJECT_ENFORCEMENT_LABEL} with conflicting labels: ${conflicts.join(", ")}`,
        );
      }
      projectEnforcementTargets.push(entry.target);
      continue;
    }
    if (entry.labels.includes(VERIFY_ISOLATED_LABEL)) {
      isolatedTargets.push(entry.target);
      continue;
    }
    if (entry.labels.includes(VERIFY_BOUNDED_ISOLATED_LABEL)) {
      boundedIsolatedTargets.push(entry.target);
      continue;
    }
    if (entry.labels.includes(VERIFY_ENFORCEMENT_LABEL)) {
      enforcementTargets.push(entry.target);
      continue;
    }
    if (entry.labels.includes(VERIFY_RESOURCE_LIMITED_LABEL)) {
      resourceLimitedTargets.push(entry.target);
      continue;
    }
    sharedTargets.push(entry.target);
  }

  const mode = opts?.isolatedMode || isolatedPassMode();
  const passes: VerifyTargetPass[] =
    mode === "per-target"
      ? isolatedTargets.map((target) => ({
          name: `isolated:${normalizeTargetLabel(target)}`,
          targets: [target],
          threadsOverride: 1,
        }))
      : isolatedTargets.length > 0
        ? [
            {
              name: "isolated",
              targets: isolatedTargets,
              threadsOverride: 1,
            },
          ]
        : [];
  if (boundedIsolatedTargets.length > 0) {
    passes.push({
      name: "isolated-bounded",
      targets: boundedIsolatedTargets,
      threadsOverride: VERIFY_BOUNDED_ISOLATED_THREADS,
    });
  }
  if (resourceLimitedTargets.length > 0) {
    passes.push({
      name: "resource-limited",
      targets: resourceLimitedTargets,
      threadsOverride:
        resourceLimitedTargets.length >= VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN
          ? VERIFY_BROAD_RESOURCE_LIMITED_THREADS
          : VERIFY_RESOURCE_LIMITED_THREADS,
    });
  }
  if (enforcementTargets.length > 0) {
    passes.push({
      name: "enforcement",
      targets: enforcementTargets,
    });
  }
  if (projectEnforcementTargets.length > 0) {
    passes.push({
      name: "project-enforcement",
      targets: projectEnforcementTargets,
      threadsOverride: 1,
    });
  }
  if (sharedTargets.length > 0) {
    passes.push({ name: "shared", targets: sharedTargets });
  }
  return passes;
}

export async function resolveVerifyTargetPlan(opts: {
  root: string;
  iso: string;
  targets: string[];
  executionPolicy: VerifyExecutionPolicy;
}): Promise<VerifyTargetPlan> {
  await ensureWorkspaceBuckStatePackage(opts.root);
  const targetLabels = loadVerifyTargetLabels(opts);
  if (opts.executionPolicy.mode !== "local") {
    await admitVerifyRemoteTargets({
      ...opts,
      targets: targetLabels.filter(
        (entry) => !entry.labels.includes(VERIFY_PROJECT_ENFORCEMENT_LABEL),
      ),
    });
  }
  return {
    targetLabels,
    passes: planVerifyTargetPasses(targetLabels),
  };
}

export function assertVerifyTargetPlanNotEmpty(opts: {
  requestedTargets: string[];
  plan: VerifyTargetPlan;
}): void {
  if (
    opts.requestedTargets.length === 0 ||
    opts.plan.targetLabels.length > 0 ||
    opts.requestedTargets.every(isVerifyTargetScan)
  ) {
    return;
  }
  throw new Error(
    `verify resolved zero concrete Buck test targets from selectors: ${opts.requestedTargets.join(" ")}`,
  );
}
