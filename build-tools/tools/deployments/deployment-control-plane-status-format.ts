#!/usr/bin/env zx-wrapper
import type {
  DeploymentControlPlaneArtifactStatus,
  DeploymentControlPlaneStatus,
} from "./deployment-control-plane-contract.ts";
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";

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
    smokeException ? `smoke exception: ${smokeException}` : undefined,
    record.errorFingerprint ? `errorFingerprint: ${String(record.errorFingerprint)}` : undefined,
    record.error || record.smokeError
      ? `diagnostic: ${redactDeploymentAuthText(String(record.error || record.smokeError))}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
