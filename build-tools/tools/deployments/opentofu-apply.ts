#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import {
  redactOperatorText,
  type DeploymentOperatorVisiblePayload,
} from "./deployment-control-plane-redaction.ts";
import {
  classifyOpenTofuPlan,
  OPENTOFU_STACK_PROVISIONER,
  type OpenTofuPlanSummary,
  type OpenTofuProvisionerMetadata,
} from "./opentofu-stack.ts";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan.ts";

export const OPENTOFU_APPLY_OUTCOME_SCHEMA = "opentofu-apply-outcome@1";

export type OpenTofuApplyAdapterCommand = {
  binary: string;
  args: string[];
  workingDirectory: string;
};

export type OpenTofuApplyAdapterResult = {
  command: OpenTofuApplyAdapterCommand;
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

export type OpenTofuApplyAdapter = {
  apply(opts: {
    planArtifactPath: string;
    stackDirectory: string;
    stateBackendIdentity: string;
    credentialEnvNames: string[];
  }): Promise<OpenTofuApplyAdapterResult>;
};

export type OpenTofuApplyOutcome = {
  schemaVersion: typeof OPENTOFU_APPLY_OUTCOME_SCHEMA;
  status: "succeeded" | "failed";
  provisionerType: typeof OPENTOFU_STACK_PROVISIONER;
  planArtifactPath: string;
  planFingerprint: string;
  stackConfigFingerprint: string;
  stackIdentity: string;
  stateBackendIdentity: string;
  mutationClass: OpenTofuPlanSummary["mutationClass"];
  destructiveExceptionRef?: string;
  command: {
    binary: string;
    workingDirectory: string;
    argCount: number;
    credentialEnvNames: string[];
  };
  exitCode: number;
  diagnostics?: DeploymentOperatorVisiblePayload;
};

export type OpenTofuApplyEvidence = {
  destructiveExceptionRef?: string;
};

export class OpenTofuApplyMismatchError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
    this.name = "OpenTofuApplyMismatchError";
  }
}

function ensureMatch(
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

function destructiveActions(summary: OpenTofuPlanSummary): string[] {
  return summary.actions.filter(
    (action) => action !== "no-op" && action !== "create" && action !== "update",
  );
}

async function readApplyPlan(planArtifactPath: string): Promise<{
  planFingerprint: string;
  stackConfigFingerprint: string;
  stackIdentity: string;
  stateBackendIdentity: string;
  summary: OpenTofuPlanSummary;
}> {
  const raw = await fsp.readFile(planArtifactPath, "utf8").catch(() => {
    throw new OpenTofuApplyMismatchError(
      "plan_artifact_missing",
      `opentofu plan artifact missing: ${planArtifactPath}`,
    );
  });
  const plan = JSON.parse(raw) as {
    opentofu?: {
      planFingerprint: string;
      stackConfigFingerprint: string;
      stackIdentity: string;
      stateBackendIdentity: string;
      summary: OpenTofuPlanSummary;
    };
  };
  if (!plan.opentofu) {
    throw new OpenTofuApplyMismatchError(
      "plan_artifact_invalid",
      `opentofu plan artifact missing opentofu block: ${planArtifactPath}`,
    );
  }
  classifyOpenTofuPlan({
    resource_changes: plan.opentofu.summary.actions.map((action) => ({
      change: { actions: [action] },
    })),
  });
  return plan.opentofu;
}

export async function runOpenTofuReviewedApply(opts: {
  provisioner: OpenTofuProvisionerMetadata;
  provisionerPlan: KubernetesProvisionerPlanRef;
  admittedProvisionerPlanFingerprint?: string;
  secretRuntime: { enterStep(step: "provision"): Promise<Record<string, string>> };
  adapter: OpenTofuApplyAdapter;
  evidence?: OpenTofuApplyEvidence;
}): Promise<OpenTofuApplyOutcome> {
  ensureMatch(
    "admitted_plan_fingerprint_mismatch",
    "admitted plan fingerprint",
    opts.provisionerPlan.fingerprint,
    opts.admittedProvisionerPlanFingerprint,
  );
  const recorded = await readApplyPlan(opts.provisionerPlan.artifactPath);
  ensureMatch(
    "plan_fingerprint_mismatch",
    "plan fingerprint",
    recorded.planFingerprint,
    opts.provisionerPlan.planFingerprint,
  );
  ensureMatch(
    "stack_config_fingerprint_mismatch",
    "stack config fingerprint",
    recorded.stackConfigFingerprint,
    opts.provisionerPlan.stackConfigFingerprint,
  );
  ensureMatch(
    "stack_identity_mismatch",
    "stack identity",
    recorded.stackIdentity,
    opts.provisioner.stackIdentity,
  );
  ensureMatch(
    "state_backend_identity_mismatch",
    "state backend identity",
    recorded.stateBackendIdentity,
    opts.provisioner.stateBackendIdentity,
  );
  const destructive = destructiveActions(recorded.summary);
  const destructiveExceptionRef = (opts.evidence?.destructiveExceptionRef || "").trim();
  if (destructive.length > 0 && !destructiveExceptionRef) {
    throw new OpenTofuApplyMismatchError(
      "destructive_plan_rejected",
      `opentofu apply destructive actions rejected without reviewed exception: ${destructive.join(", ")}`,
    );
  }
  const credentials = await opts.secretRuntime.enterStep("provision");
  const credentialEnvNames = Object.keys(credentials).sort();
  const adapterResult = await opts.adapter
    .apply({
      planArtifactPath: opts.provisionerPlan.artifactPath,
      stackDirectory: opts.provisioner.stackDirectory,
      stateBackendIdentity: opts.provisioner.stateBackendIdentity,
      credentialEnvNames,
    })
    .catch((error) => ({
      command: {
        binary: "tofu",
        args: [],
        workingDirectory: opts.provisioner.stackDirectory,
      },
      exitCode: 1,
      stderr: error instanceof Error ? error.message : String(error),
    }));
  const diagnostics =
    adapterResult.exitCode === 0
      ? redactOperatorText(adapterResult.stdout)
      : redactOperatorText(adapterResult.stderr || adapterResult.stdout);
  return {
    schemaVersion: OPENTOFU_APPLY_OUTCOME_SCHEMA,
    status: adapterResult.exitCode === 0 ? "succeeded" : "failed",
    provisionerType: OPENTOFU_STACK_PROVISIONER,
    planArtifactPath: opts.provisionerPlan.artifactPath,
    planFingerprint: recorded.planFingerprint,
    stackConfigFingerprint: recorded.stackConfigFingerprint,
    stackIdentity: opts.provisioner.stackIdentity,
    stateBackendIdentity: opts.provisioner.stateBackendIdentity,
    mutationClass: recorded.summary.mutationClass,
    ...(destructiveExceptionRef ? { destructiveExceptionRef } : {}),
    command: {
      binary: adapterResult.command.binary,
      workingDirectory: adapterResult.command.workingDirectory,
      argCount: adapterResult.command.args.length,
      credentialEnvNames,
    },
    exitCode: adapterResult.exitCode,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function isOpenTofuProvisioner(
  provisioner: { type?: string } | undefined,
): provisioner is OpenTofuProvisionerMetadata {
  return provisioner?.type === OPENTOFU_STACK_PROVISIONER;
}
