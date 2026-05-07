#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { classifyOpenTofuPlan, type OpenTofuPlanSummary } from "./opentofu-stack";
import { OpenTofuApplyMismatchError } from "./opentofu-apply-errors";

export type OpenTofuRecordedApplyPlan = {
  configPath: string;
  planJsonPath: string;
  applyPlanPath: string;
  planFingerprint: string;
  stackConfigFingerprint: string;
  stackIdentity: string;
  stateBackendIdentity: string;
  summary: OpenTofuPlanSummary;
};

export function requireOpenTofuApplyText(
  reason: string,
  field: string,
  value: string | undefined,
): string {
  const trimmed = (value || "").trim();
  if (trimmed) return trimmed;
  throw new OpenTofuApplyMismatchError(reason, `opentofu apply requires ${field}`);
}

export function requireOpenTofuApplyMatch(
  reason: string,
  field: string,
  expected: string | undefined,
  actual: string | undefined,
) {
  if ((expected || "") === (actual || "")) return;
  throw new OpenTofuApplyMismatchError(
    reason,
    `opentofu apply ${field} mismatch: recorded=${expected || ""} admitted=${actual || ""}`,
  );
}

export function destructiveOpenTofuActions(summary: OpenTofuPlanSummary): string[] {
  return summary.actions.filter(
    (action) => action !== "no-op" && action !== "create" && action !== "update",
  );
}

export async function readOpenTofuApplyPlan(
  planArtifactPath: string,
): Promise<OpenTofuRecordedApplyPlan> {
  const raw = await fsp.readFile(planArtifactPath, "utf8").catch(() => {
    throw new OpenTofuApplyMismatchError(
      "plan_artifact_missing",
      `opentofu plan artifact missing: ${planArtifactPath}`,
    );
  });
  const plan = JSON.parse(raw) as { opentofu?: OpenTofuRecordedApplyPlan };
  if (!plan.opentofu) {
    throw new OpenTofuApplyMismatchError(
      "plan_artifact_invalid",
      `opentofu plan artifact missing opentofu block: ${planArtifactPath}`,
    );
  }
  if (plan.opentofu.applyPlanPath === plan.opentofu.planJsonPath) {
    throw new OpenTofuApplyMismatchError(
      "apply_plan_artifact_invalid",
      "opentofu apply plan must be separate from reviewed plan JSON",
    );
  }
  classifyOpenTofuPlan({
    resource_changes: plan.opentofu.summary.actions.map((action) => ({
      change: { actions: [action] },
    })),
  });
  return plan.opentofu;
}
