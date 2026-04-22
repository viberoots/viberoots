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
    approvalLine(status),
    diagnosticLine(status),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatDeploymentControlPlaneRecordText(record: any): string {
  return [
    `record: ${String(record.deployRunId || "unknown")}`,
    `outcome: ${String(record.finalOutcome || "unknown")}`,
    record.artifactIdentity ? `artifact: ${String(record.artifactIdentity)}` : undefined,
    record.error || record.smokeError
      ? `diagnostic: ${redactDeploymentAuthText(String(record.error || record.smokeError))}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
