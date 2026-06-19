import { spawnSync } from "node:child_process";
import process from "node:process";
import { dropConfigSuffix, normalizeTargetLabel } from "../../lib/labels";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { buckCqueryArgsForExecutionPolicy, targetPlatformArgsForPolicy } from "./remote-policy";
import { assertVerifyRemoteTargetsAllowed } from "./remote-target-policy";
import type { VerifyExecutionPolicy } from "./remote-policy";

export const VERIFY_ISOLATED_LABEL = "verify:isolated";
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

type CqueryTargetInfo = {
  labels?: string[];
};

function cqueryLiteral(target: string): string {
  return JSON.stringify(String(target || ""));
}

export function normalizeVerifyTargetLabel(label: string): string {
  const withoutConfig = dropConfigSuffix(label);
  if (withoutConfig.startsWith("root//")) return `//${withoutConfig.slice("root//".length)}`;
  if (withoutConfig.startsWith("@")) return withoutConfig.slice(1);
  return withoutConfig;
}

export function buildCqueryQuery(targets: readonly string[]): string {
  if (targets.length === 1) return cqueryLiteral(targets[0]!);
  return `set(${targets.map(cqueryLiteral).join(" ")})`;
}

function isPatternVerifyTarget(target: string): boolean {
  const trimmed = String(target || "").trim();
  if (trimmed === "//...") return true;
  if (trimmed.startsWith("//") && trimmed.endsWith("/...")) return true;
  if (/^@?[^/]+\/\/\.\.\.$/.test(trimmed)) return true;
  return /^@?[^/]+\/\/.*\/\.\.\.$/.test(trimmed);
}

function isManualVerifyTarget(labels: readonly string[]): boolean {
  return labels.includes(VERIFY_MANUAL_LABEL);
}

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
      threadsOverride:
        resourceLimitedTargets.length >= VERIFY_BROAD_RESOURCE_LIMITED_TARGET_MIN
          ? VERIFY_BROAD_RESOURCE_LIMITED_THREADS
          : VERIFY_RESOURCE_LIMITED_THREADS,
    });
  }
  if (sharedTargets.length > 0) {
    passes.push({ name: "shared", targets: sharedTargets });
  }
  return passes;
}

function parseVerifyTargetLabelsJson(stdout: string): Map<string, readonly string[]> {
  const parsed = JSON.parse(stdout) as Record<string, CqueryTargetInfo>;
  const out = new Map<string, readonly string[]>();
  for (const [label, attrs] of Object.entries(parsed || {})) {
    out.set(normalizeVerifyTargetLabel(label), Array.isArray(attrs?.labels) ? attrs.labels : []);
  }
  return out;
}

function queryVerifyTargetLabels(opts: {
  root: string;
  iso: string;
  query: string;
  executionPolicy: VerifyExecutionPolicy;
}): Map<string, readonly string[]> {
  const buck2Path = resolveToolPathSync("buck2");
  const result = spawnSync(
    buck2Path,
    [
      "--isolation-dir",
      opts.iso,
      "cquery",
      ...buckCqueryArgsForExecutionPolicy(opts.executionPolicy),
      ...targetPlatformArgsForPolicy(opts.executionPolicy),
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
  executionPolicy: VerifyExecutionPolicy;
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
      executionPolicy: opts.executionPolicy,
    });
    for (const target of explicitTargets) {
      const normalizedTarget = normalizeVerifyTargetLabel(target);
      resolved.set(normalizedTarget, labelsByTarget.get(normalizedTarget) ?? []);
    }
  }

  if (patternTargets.length > 0) {
    const labelsByTarget = queryVerifyTargetLabels({
      root: opts.root,
      iso: opts.iso,
      query: `kind(test, ${buildCqueryQuery(patternTargets)})`,
      executionPolicy: opts.executionPolicy,
    });
    const expandedTargets = [...labelsByTarget.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
    for (const target of expandedTargets) {
      const labels = labelsByTarget.get(target) ?? [];
      if (isManualVerifyTarget(labels)) continue;
      if (!resolved.has(target)) {
        resolved.set(target, labels);
      }
    }
  }

  return [...resolved.entries()].map(([target, labels]) => ({ target, labels }));
}

export function resolveVerifyTargetPlan(opts: {
  root: string;
  iso: string;
  targets: string[];
  executionPolicy: VerifyExecutionPolicy;
}): VerifyTargetPlan {
  const targetLabels = loadVerifyTargetLabels(opts);
  if (opts.executionPolicy.mode !== "local") {
    assertVerifyRemoteTargetsAllowed({ ...opts, targets: targetLabels });
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
  if (opts.requestedTargets.length === 0 || opts.plan.targetLabels.length > 0) return;
  throw new Error(
    `verify resolved zero concrete Buck test targets from selectors: ${opts.requestedTargets.join(" ")}`,
  );
}
