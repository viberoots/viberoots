#!/usr/bin/env zx-wrapper
import path from "node:path";
import {
  redactOperatorText,
  type DeploymentOperatorVisiblePayload,
} from "./deployment-control-plane-redaction";
import {
  OPENTOFU_STACK_PROVISIONER,
  type OpenTofuPlanSummary,
  type OpenTofuProvisionerMetadata,
} from "./opentofu-stack";
import type { KubernetesProvisionerPlanRef } from "./kubernetes-provisioner-plan";
import { OpenTofuApplyMismatchError } from "./opentofu-apply-errors";
import {
  destructiveOpenTofuActions,
  readOpenTofuApplyPlan,
  requireOpenTofuApplyMatch,
  requireOpenTofuApplyText,
} from "./opentofu-apply-plan";

export const OPENTOFU_APPLY_OUTCOME_SCHEMA = "opentofu-apply-outcome@1";
export { OpenTofuApplyMismatchError } from "./opentofu-apply-errors";
export { createProductionOpenTofuApplyAdapter } from "./opentofu-apply-production";

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
    applyPlanPath: string;
    stackDirectory: string;
    stateBackendIdentity: string;
    credentialEnvNames: string[];
    credentialEnv: Record<string, string>;
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

function requireAdapterResult(
  result: OpenTofuApplyAdapterResult,
  fallbackWorkingDirectory: string,
): OpenTofuApplyAdapterResult {
  if (!result || typeof result.exitCode !== "number" || !result.command?.binary) {
    throw new OpenTofuApplyMismatchError(
      "apply_outcome_missing",
      "opentofu apply adapter exited without a recorded provider outcome",
    );
  }
  return {
    ...result,
    command: {
      binary: result.command.binary,
      args: Array.isArray(result.command.args) ? result.command.args : [],
      workingDirectory: result.command.workingDirectory || fallbackWorkingDirectory,
    },
  };
}

export async function runOpenTofuReviewedApply(opts: {
  provisioner: OpenTofuProvisionerMetadata;
  provisionerPlan: KubernetesProvisionerPlanRef;
  admittedProvisionerPlanFingerprint?: string;
  secretRuntime: { enterStep(step: "provision"): Promise<Record<string, string>> };
  adapter: OpenTofuApplyAdapter;
  evidence?: OpenTofuApplyEvidence;
}): Promise<OpenTofuApplyOutcome> {
  const admittedFingerprint = requireOpenTofuApplyText(
    "admitted_plan_fingerprint_missing",
    "admitted plan fingerprint",
    opts.admittedProvisionerPlanFingerprint,
  );
  const planFingerprint = requireOpenTofuApplyText(
    "plan_fingerprint_missing",
    "plan fingerprint",
    opts.provisionerPlan.planFingerprint,
  );
  const stackConfigFingerprint = requireOpenTofuApplyText(
    "stack_config_fingerprint_missing",
    "stack config fingerprint",
    opts.provisionerPlan.stackConfigFingerprint,
  );
  const stateBackendIdentity = requireOpenTofuApplyText(
    "state_backend_identity_missing",
    "state backend identity",
    opts.provisioner.stateBackendIdentity,
  );
  const stackIdentity = requireOpenTofuApplyText(
    "stack_identity_missing",
    "stack identity",
    opts.provisioner.stackIdentity,
  );
  requireOpenTofuApplyMatch(
    "admitted_plan_fingerprint_mismatch",
    "admitted plan fingerprint",
    opts.provisionerPlan.fingerprint,
    admittedFingerprint,
  );
  const recorded = await readOpenTofuApplyPlan(opts.provisionerPlan.artifactPath);
  const recordedPlanFingerprint = requireOpenTofuApplyText(
    "recorded_plan_fingerprint_missing",
    "recorded plan fingerprint",
    recorded.planFingerprint,
  );
  const recordedStackConfigFingerprint = requireOpenTofuApplyText(
    "recorded_stack_config_fingerprint_missing",
    "recorded stack config fingerprint",
    recorded.stackConfigFingerprint,
  );
  const recordedStateBackendIdentity = requireOpenTofuApplyText(
    "recorded_state_backend_identity_missing",
    "recorded state backend identity",
    recorded.stateBackendIdentity,
  );
  const recordedStackIdentity = requireOpenTofuApplyText(
    "recorded_stack_identity_missing",
    "recorded stack identity",
    recorded.stackIdentity,
  );
  const recordedApplyPlanPath = requireOpenTofuApplyText(
    "recorded_apply_plan_missing",
    "recorded saved apply plan path",
    recorded.applyPlanPath,
  );
  requireOpenTofuApplyMatch(
    "plan_fingerprint_mismatch",
    "plan fingerprint",
    recordedPlanFingerprint,
    planFingerprint,
  );
  requireOpenTofuApplyMatch(
    "stack_config_fingerprint_mismatch",
    "stack config fingerprint",
    recordedStackConfigFingerprint,
    stackConfigFingerprint,
  );
  requireOpenTofuApplyMatch(
    "stack_identity_mismatch",
    "stack identity",
    recordedStackIdentity,
    stackIdentity,
  );
  requireOpenTofuApplyMatch(
    "state_backend_identity_mismatch",
    "state backend identity",
    recordedStateBackendIdentity,
    stateBackendIdentity,
  );
  const destructive = destructiveOpenTofuActions(recorded.summary);
  const destructiveExceptionRef = (opts.evidence?.destructiveExceptionRef || "").trim();
  if (destructive.length > 0 && !destructiveExceptionRef) {
    throw new OpenTofuApplyMismatchError(
      "destructive_plan_rejected",
      `opentofu apply destructive actions rejected without reviewed exception: ${destructive.join(", ")}`,
    );
  }
  const credentials = await opts.secretRuntime.enterStep("provision");
  const credentialEnvNames = Object.keys(credentials).sort();
  if (credentialEnvNames.length === 0) {
    throw new OpenTofuApplyMismatchError(
      "provider_credentials_missing",
      "opentofu apply requires provider credentials resolved from deployment secret requirements",
    );
  }
  const stackDirectory = path.resolve(path.dirname(recorded.configPath), ".");
  const adapterResult = await opts.adapter
    .apply({
      planArtifactPath: opts.provisionerPlan.artifactPath,
      applyPlanPath: recordedApplyPlanPath,
      stackDirectory,
      stateBackendIdentity,
      credentialEnvNames,
      credentialEnv: credentials,
    })
    .then((result) => requireAdapterResult(result, stackDirectory))
    .catch((error) => ({
      command: {
        binary: "tofu",
        args: [],
        workingDirectory: stackDirectory,
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
    planFingerprint: recordedPlanFingerprint,
    stackConfigFingerprint: recordedStackConfigFingerprint,
    stackIdentity,
    stateBackendIdentity,
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
