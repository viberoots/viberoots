import { spawnSync } from "node:child_process";
import process from "node:process";
import { normalizeTargetLabel } from "../../lib/labels.ts";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

export const VERIFY_ISOLATED_LABEL = "verify:isolated";

export type VerifyTargetLabels = {
  target: string;
  labels: readonly string[];
};

export type VerifyTargetPass = {
  name: string;
  targets: string[];
  threadsOverride?: number;
};

type CqueryTargetInfo = {
  labels?: string[];
};

export function planVerifyTargetPasses(targets: readonly VerifyTargetLabels[]): VerifyTargetPass[] {
  const sharedTargets: string[] = [];
  const isolatedTargets: string[] = [];

  for (const entry of targets) {
    if (entry.labels.includes(VERIFY_ISOLATED_LABEL)) {
      isolatedTargets.push(entry.target);
      continue;
    }
    sharedTargets.push(entry.target);
  }

  const passes: VerifyTargetPass[] = isolatedTargets.map((target) => ({
    name: `isolated:${normalizeTargetLabel(target)}`,
    targets: [target],
    threadsOverride: 1,
  }));
  if (sharedTargets.length > 0) {
    passes.push({ name: "shared", targets: sharedTargets });
  }
  return passes;
}

function parseVerifyTargetLabelsJson(stdout: string): Map<string, readonly string[]> {
  const parsed = JSON.parse(stdout) as Record<string, CqueryTargetInfo>;
  const out = new Map<string, readonly string[]>();
  for (const [label, attrs] of Object.entries(parsed || {})) {
    out.set(normalizeTargetLabel(label), Array.isArray(attrs?.labels) ? attrs.labels : []);
  }
  return out;
}

export function loadVerifyTargetLabels(opts: {
  root: string;
  iso: string;
  targets: string[];
}): VerifyTargetLabels[] {
  if (opts.targets.length === 0) return [];
  const query =
    opts.targets.length === 1
      ? opts.targets[0]!
      : `(${opts.targets.map((target) => `${target}`).join(" + ")})`;
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
      query,
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
  const labelsByTarget = parseVerifyTargetLabelsJson(String(result.stdout || "{}"));
  return opts.targets.map((target) => ({
    target,
    labels: labelsByTarget.get(normalizeTargetLabel(target)) ?? [],
  }));
}
