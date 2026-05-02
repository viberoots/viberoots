import { spawnSync } from "node:child_process";
import process from "node:process";
import { normalizeTargetLabel } from "../../lib/labels.ts";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

export const VERIFY_ISOLATED_LABEL = "verify:isolated";
export const VERIFY_RESOURCE_LIMITED_LABEL = "verify:resource-limited";
export const VERIFY_RESOURCE_LIMITED_THREADS = 4;

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

type CqueryTargetInfo = {
  labels?: string[];
};

function buildCqueryQuery(targets: readonly string[]): string {
  return targets.length === 1
    ? targets[0]!
    : `(${targets.map((target) => `${target}`).join(" + ")})`;
}

function isPatternVerifyTarget(target: string): boolean {
  const trimmed = String(target || "").trim();
  return trimmed === "//..." || (trimmed.startsWith("//") && trimmed.endsWith("/..."));
}

type IsolatedPassMode = "batch" | "per-target";

function isolatedPassMode(env: NodeJS.ProcessEnv = process.env): IsolatedPassMode {
  return String(env.BNX_VERIFY_ISOLATED_PASS_MODE || "").trim() === "per-target"
    ? "per-target"
    : "batch";
}

export function planVerifyTargetPasses(
  targets: readonly VerifyTargetLabels[],
  opts?: { isolatedMode?: IsolatedPassMode },
): VerifyTargetPass[] {
  const sharedTargets: string[] = [];
  const isolatedTargets: string[] = [];
  const resourceLimitedTargets: string[] = [];

  for (const entry of targets) {
    if (entry.labels.includes(VERIFY_ISOLATED_LABEL)) {
      isolatedTargets.push(entry.target);
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
  if (resourceLimitedTargets.length > 0) {
    passes.push({
      name: "resource-limited",
      targets: resourceLimitedTargets,
      threadsOverride: VERIFY_RESOURCE_LIMITED_THREADS,
    });
  }
  if (sharedTargets.length > 0) {
    passes.push({ name: "shared", targets: sharedTargets });
  }
  return passes;
}

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

function parseVerifyTargetLabelsJson(stdout: string): Map<string, readonly string[]> {
  const parsed = JSON.parse(stdout) as Record<string, CqueryTargetInfo>;
  const out = new Map<string, readonly string[]>();
  for (const [label, attrs] of Object.entries(parsed || {})) {
    out.set(normalizeTargetLabel(label), Array.isArray(attrs?.labels) ? attrs.labels : []);
  }
  return out;
}

function queryVerifyTargetLabels(opts: {
  root: string;
  iso: string;
  query: string;
}): Map<string, readonly string[]> {
  const buck2Path = resolveToolPathSync("buck2");
  const result = spawnSync(
    buck2Path,
    [
      "--isolation-dir",
      opts.iso,
      "cquery",
      "--target-platforms",
      "prelude//platforms:default",
      "--json",
      "--output-attribute",
      "labels",
      opts.query,
    ],
    {
      cwd: opts.root,
      env: {
        ...process.env,
        RUST_LOG:
          (process.env.RUST_LOG || "warn") +
          ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
        BUCK_LOG:
          (process.env.BUCK_LOG || "warn") +
          ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`verify target label cquery failed (${result.status}): ${stderr}`);
  }
  return parseVerifyTargetLabelsJson(String(result.stdout || "{}"));
}

export function loadVerifyTargetLabels(opts: {
  root: string;
  iso: string;
  targets: string[];
}): VerifyTargetLabels[] {
  if (opts.targets.length === 0) return [];
  const explicitTargets = opts.targets.filter((target) => !isPatternVerifyTarget(target));
  const patternTargets = opts.targets.filter(isPatternVerifyTarget);
  const resolved = new Map<string, readonly string[]>();

  if (explicitTargets.length > 0) {
    const labelsByTarget = queryVerifyTargetLabels({
      root: opts.root,
      iso: opts.iso,
      query: buildCqueryQuery(explicitTargets),
    });
    for (const target of explicitTargets) {
      const normalizedTarget = normalizeTargetLabel(target);
      resolved.set(normalizedTarget, labelsByTarget.get(normalizedTarget) ?? []);
    }
  }

  if (patternTargets.length > 0) {
    const labelsByTarget = queryVerifyTargetLabels({
      root: opts.root,
      iso: opts.iso,
      query: `kind(test, ${buildCqueryQuery(patternTargets)})`,
    });
    const expandedTargets = [...labelsByTarget.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
    for (const target of expandedTargets) {
      if (!resolved.has(target)) {
        resolved.set(target, labelsByTarget.get(target) ?? []);
      }
    }
  }

  return [...resolved.entries()].map(([target, labels]) => ({ target, labels }));
}

export function resolveVerifyTargetPlan(opts: {
  root: string;
  iso: string;
  targets: string[];
}): VerifyTargetPlan {
  const targetLabels = loadVerifyTargetLabels(opts);
  return {
    targetLabels,
    passes: planVerifyTargetPasses(targetLabels),
  };
}

export function assertVerifyTargetPlanNotEmpty(opts: {
  requestedTargets: string[];
  plan: VerifyTargetPlan;
}): void {
  if (opts.requestedTargets.length === 0 || opts.plan.targetLabels.length > 0) return;
  throw new Error(
    `verify resolved zero concrete Buck test targets from selectors: ${opts.requestedTargets.join(" ")}`,
  );
}
