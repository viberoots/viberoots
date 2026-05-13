#!/usr/bin/env zx-wrapper
import type {
  DeploymentControlPlaneArtifactStatus,
  DeploymentControlPlaneStatus,
} from "./deployment-control-plane-contract";
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";

function phaseMessage(status: DeploymentControlPlaneStatus): string {
  if (status.lifecycleState === "pending_approval") return "pending approval";
  if (status.lifecycleState === "waiting_for_lock") return "waiting for deployment lock";
  if (status.lifecycleState === "queued") return "queued for worker execution";
  if (status.lifecycleState === "running") return "running on the deployment worker";
  if (status.lifecycleState === "finished") {
    return `finished: ${status.finalOutcome || "unknown outcome"}`;
  }
  if (status.lifecycleState === "cancelled") return "cancelled";
  return status.lifecycleState.replaceAll("_", " ");
}

function artifactDigest(artifact: DeploymentControlPlaneArtifactStatus): string | undefined {
  if (artifact.artifactDigest) return artifact.artifactDigest;
  const identity = artifact.artifactIdentity || "";
  return identity.startsWith("static-webapp:")
    ? identity.slice("static-webapp:".length)
    : undefined;
}

function artifactLine(artifact?: DeploymentControlPlaneArtifactStatus): string | undefined {
  if (!artifact) return undefined;
  const parts = [
    artifact.phase.replaceAll("_", " "),
    artifact.producerKind,
    artifact.artifactIdentity,
  ].filter(Boolean);
  const digest = artifactDigest(artifact);
  return `artifact: ${parts.join(" | ")}${digest ? ` | digest ${digest}` : ""}`;
}

function approvalLine(status: DeploymentControlPlaneStatus): string | undefined {
  if (status.lifecycleState !== "pending_approval" || status.approval?.state !== "pending") {
    return undefined;
  }
  const selector = status.deployRunId
    ? `--deploy-run-id ${status.deployRunId}`
    : `--submission-id ${status.submissionId}`;
  return `approval: deploy --approve ${selector} --approval-id <review-ref>`;
}

function diagnosticLine(status: DeploymentControlPlaneStatus): string | undefined {
  const diagnostic = [
    status.rejectionCode ? `rejection ${status.rejectionCode}` : "",
    status.terminationReason ? `termination ${status.terminationReason}` : "",
    status.finalOutcome && status.finalOutcome !== "succeeded"
      ? `outcome ${status.finalOutcome}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  return diagnostic ? `diagnostic: ${redactDeploymentAuthText(diagnostic)}` : undefined;
}

function executionLine(status: DeploymentControlPlaneStatus): string | undefined {
  if (!status.execution?.currentStep) return undefined;
  const parts = [
    status.execution.currentStep,
    status.execution.stepStartedAt ? `started ${status.execution.stepStartedAt}` : "",
    status.execution.timeoutMs ? `timeout ${status.execution.timeoutMs}ms` : "",
  ].filter(Boolean);
  return `execution: ${parts.join(" | ")}`;
}

function serviceLine(status: DeploymentControlPlaneStatus): string | undefined {
  const service = status.serviceInstance;
  if (!service?.gitHead && !service?.hostname) return undefined;
  return [
    service.gitHead ? `git ${service.gitHead}` : "",
    service.hostname ? `host ${service.hostname}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function smokeBudgetLine(record: any): string | undefined {
  const budget = record.executionPolicy?.smokeBudget;
  if (!budget) return undefined;
  const parts = [
    budget.runnerClass ? `class ${String(budget.runnerClass)}` : "",
    budget.totalBudgetMs ? `budget ${String(budget.totalBudgetMs)}ms` : "",
    budget.source ? `source ${String(budget.source)}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `smoke budget: ${parts.join(" | ")}` : undefined;
}

function shortDiagnostic(value: unknown): string {
  const text = redactDeploymentAuthText(
    String(value || "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

function retryLine(record: any): string | undefined {
  const retries = Array.isArray(record.executionPolicy?.retries)
    ? record.executionPolicy.retries
    : [];
  const retry = retries.at(-1);
  if (!retry) return undefined;
  const attempts = Array.isArray(retry.attempts) ? retry.attempts : [];
  const lastAttempt = attempts.at(-1);
  const maxAttempts =
    typeof retry.maxRetries === "number" ? Number(retry.maxRetries) + 1 : undefined;
  const parts = [
    retry.step ? `step ${String(retry.step)}` : "",
    typeof retry.totalAttempts === "number"
      ? `attempts ${String(retry.totalAttempts)}${maxAttempts ? `/${String(maxAttempts)}` : ""}`
      : "",
    typeof retry.retriesUsed === "number" ? `retries ${String(retry.retriesUsed)}` : "",
    retry.exhaustedBudget ? "budget exhausted" : "",
    lastAttempt?.reasonCode ? `last ${String(lastAttempt.reasonCode)}` : "",
    lastAttempt?.message ? `message ${shortDiagnostic(lastAttempt.message)}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `retry: ${parts.join(" | ")}` : undefined;
}

export function formatDeploymentControlPlaneStatusText(
  status: DeploymentControlPlaneStatus,
): string {
  return [
    `status: ${phaseMessage(status)}`,
    `submissionId: ${status.submissionId}`,
    status.deployRunId ? `deployRunId: ${status.deployRunId}` : undefined,
    `deployment: ${status.deploymentLabel}`,
    `target: ${status.providerTargetIdentity}`,
    artifactLine(status.artifact),
    executionLine(status),
    serviceLine(status) ? `service: ${serviceLine(status)}` : undefined,
    approvalLine(status),
    diagnosticLine(status),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDeploymentControlPlaneRecordText(record: any): string {
  const controlPlane = record.controlPlane || record.authority;
  const smokeException = record.smokeException
    ? [
        record.smokeException.scope ? `scope ${String(record.smokeException.scope)}` : "",
        record.smokeException.owner ? `owner ${String(record.smokeException.owner)}` : "",
        record.smokeException.expiresAt ? `expires ${String(record.smokeException.expiresAt)}` : "",
        record.smokeException.reviewBy ? `review ${String(record.smokeException.reviewBy)}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    : "";
  return [
    `record: ${String(record.deployRunId || "unknown")}`,
    `outcome: ${String(record.finalOutcome || "unknown")}`,
    record.failedStep ? `failed step: ${String(record.failedStep)}` : undefined,
    record.deploymentLabel ? `deployment: ${String(record.deploymentLabel)}` : undefined,
    record.providerTargetIdentity ? `target: ${String(record.providerTargetIdentity)}` : undefined,
    controlPlane?.submissionId ? `submissionId: ${String(controlPlane.submissionId)}` : undefined,
    controlPlane?.workerId ? `workerId: ${String(controlPlane.workerId)}` : undefined,
    controlPlane?.lockScope ? `lockScope: ${String(controlPlane.lockScope)}` : undefined,
    record.publicUrl ? `publicUrl: ${String(record.publicUrl)}` : undefined,
    record.providerReleaseId ? `providerReleaseId: ${String(record.providerReleaseId)}` : undefined,
    record.artifact?.identity
      ? `artifact: ${String(record.artifact.identity)}`
      : record.artifactIdentity
        ? `artifact: ${String(record.artifactIdentity)}`
        : undefined,
    record.smokeOutcome ? `smoke: ${String(record.smokeOutcome)}` : undefined,
    smokeBudgetLine(record),
    retryLine(record),
    smokeException ? `smoke exception: ${smokeException}` : undefined,
    record.errorFingerprint ? `errorFingerprint: ${String(record.errorFingerprint)}` : undefined,
    record.error || record.smokeError
      ? `diagnostic: ${redactDeploymentAuthText(String(record.error || record.smokeError))}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDeploymentCurrentStageStateText(state: DeploymentCurrentStageState): string {
  return [
    `current stage: ${state.deploymentId} ${state.environmentStage}`,
    `deployment: ${state.deploymentLabel}`,
    `target: ${state.providerTargetIdentity}`,
    `currentRunId: ${state.currentRunId}`,
    state.sourceRunId ? `sourceRunId: ${state.sourceRunId}` : undefined,
    `sourceRevision: ${state.sourceRevision}`,
    `artifact: ${state.artifactIdentity}`,
    `artifactReuseMode: ${state.artifactReuseMode}`,
    state.parentRunId ? `parentRunId: ${state.parentRunId}` : undefined,
    state.releaseLineageId ? `releaseLineageId: ${state.releaseLineageId}` : undefined,
    state.artifactLineageId ? `artifactLineageId: ${state.artifactLineageId}` : undefined,
    `outcome: ${state.finalOutcome}`,
    `updatedAt: ${state.updatedAt}`,
    state.approvalContext
      ? `approval: ${state.approvalContext.requiredApprovals.join(",") || "none"}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
