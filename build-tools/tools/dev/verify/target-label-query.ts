import { spawnSync } from "node:child_process";
import { withGitAutoMaintenanceDisabledEnv } from "../../lib/git-auto-maintenance-env";
import { dropConfigSuffix } from "../../lib/labels";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { buildBuckProcessEnvForPolicy } from "./buck2-test-remote-env";
import { buckCqueryArgsForExecutionPolicy, targetPlatformArgsForPolicy } from "./remote-policy";
import type { VerifyExecutionPolicy } from "./remote-policy";
import type { VerifyTargetLabels } from "./target-passes";

type CqueryTargetInfo = { labels?: string[] };

export function normalizeVerifyTargetLabel(label: string): string {
  const withoutConfig = dropConfigSuffix(label);
  if (withoutConfig.startsWith("root//")) return `//${withoutConfig.slice("root//".length)}`;
  if (withoutConfig.startsWith("@")) return withoutConfig.slice(1);
  return withoutConfig;
}

export function buildCqueryQuery(targets: readonly string[]): string {
  const literals = targets.map((target) => JSON.stringify(String(target || "")));
  return targets.length === 1 ? literals[0]! : `set(${literals.join(" ")})`;
}

function isPattern(target: string): boolean {
  const trimmed = String(target || "").trim();
  if (trimmed === "//...") return true;
  if (trimmed.startsWith("//") && trimmed.endsWith("/...")) return true;
  if (/^@?[^/]+\/\/\.\.\.$/.test(trimmed)) return true;
  return /^@?[^/]+\/\/.*\/\.\.\.$/.test(trimmed);
}

export function isBroadVerifyTargetScan(target: string): boolean {
  return String(target || "").trim() === "//...";
}

export function isVerifyTargetScan(target: string): boolean {
  return isPattern(target);
}

function queryLabels(opts: {
  root: string;
  iso: string;
  query: string;
  executionPolicy: VerifyExecutionPolicy;
}): Map<string, readonly string[]> {
  const result = spawnSync(
    resolveToolPathSync("buck2"),
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
        ...withGitAutoMaintenanceDisabledEnv(buildBuckProcessEnvForPolicy(opts.executionPolicy)),
        RUST_LOG: `${process.env.RUST_LOG || "warn"},buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off`,
        BUCK_LOG: `${process.env.BUCK_LOG || "warn"},buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off`,
      },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `verify target label cquery failed (${result.status}): ${String(result.stderr || "").trim()}`,
    );
  }
  const parsed = JSON.parse(String(result.stdout || "{}")) as Record<string, CqueryTargetInfo>;
  return new Map(
    Object.entries(parsed || {}).map(([label, attrs]) => [
      normalizeVerifyTargetLabel(label),
      Array.isArray(attrs?.labels) ? attrs.labels : [],
    ]),
  );
}

export function loadVerifyTargetLabels(opts: {
  root: string;
  iso: string;
  targets: string[];
  executionPolicy: VerifyExecutionPolicy;
}): VerifyTargetLabels[] {
  if (opts.targets.length === 0) return [];
  const explicit = opts.targets.filter((target) => !isPattern(target));
  const patterns = opts.targets.filter(isPattern);
  const resolved = new Map<string, readonly string[]>();
  if (explicit.length > 0) {
    const labels = queryLabels({ ...opts, query: buildCqueryQuery(explicit) });
    for (const target of explicit) {
      const normalized = normalizeVerifyTargetLabel(target);
      resolved.set(normalized, labels.get(normalized) ?? []);
    }
  }
  if (patterns.length > 0) {
    const labels = queryLabels({ ...opts, query: `kind(test, ${buildCqueryQuery(patterns)})` });
    for (const target of [...labels.keys()].sort((a, b) => a.localeCompare(b))) {
      const targetLabels = labels.get(target) ?? [];
      if (targetLabels.includes("verify:manual")) continue;
      if (!resolved.has(target)) resolved.set(target, targetLabels);
    }
  }
  return [...resolved.entries()].map(([target, labels]) => ({ target, labels }));
}
