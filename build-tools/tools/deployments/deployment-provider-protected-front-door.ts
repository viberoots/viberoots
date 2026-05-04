#!/usr/bin/env zx-wrapper
import type { DeploymentControlPlaneStatus } from "./deployment-control-plane-contract";
import {
  readNixosSharedHostControlPlaneRecordViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "./nixos-shared-host-control-plane-client";
import { controlPlaneRecordFailureMessage } from "./deployment-control-plane-record-failure";

const SERVICE_ONLY_LOCAL_FLAGS = ["records-root", "control-plane-database-url"] as const;

export function rejectServiceOnlyLocalFlags(hasFlag: (flag: string) => boolean, provider: string) {
  const conflicts = SERVICE_ONLY_LOCAL_FLAGS.filter((flag) => hasFlag(flag));
  if (conflicts.length === 0) return;
  throw new Error(
    `service-only ${provider} deploy does not support ${conflicts.map((flag) => `--${flag}`).join(", ")}`,
  );
}

export function terminalControlPlaneRejectionMessage(status: DeploymentControlPlaneStatus) {
  const reason = status.rejectionCode || status.terminationReason;
  if (!reason) return undefined;
  const deployment = status.deploymentId ? ` for ${status.deploymentId}` : "";
  const detail =
    typeof status.rejectionMessage === "string" && status.rejectionMessage.trim()
      ? `: ${status.rejectionMessage.trim()}`
      : "";
  return `shared control-plane mutation rejected${deployment}: ${reason}${detail}`;
}

async function readFinalizedRecord(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  deployRunId: string;
}) {
  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      return await readNixosSharedHostControlPlaneRecordViaService({
        controlPlaneUrl: opts.controlPlaneUrl,
        ...(opts.controlPlaneToken ? { token: opts.controlPlaneToken } : {}),
        deployRunId: opts.deployRunId,
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("record not found")) throw error;
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function finalizeProtectedFrontDoorSubmission(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  request: any;
}) {
  const { final } = await submitNixosSharedHostControlPlaneViaService({
    controlPlaneUrl: opts.controlPlaneUrl,
    token: opts.controlPlaneToken,
    request: opts.request,
  });
  const rejectionMessage = terminalControlPlaneRejectionMessage(final);
  if (rejectionMessage) throw Object.assign(new Error(rejectionMessage), { status: final });
  if (!final.deployRunId) return final;
  return await requireSucceededRecord({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { controlPlaneToken: opts.controlPlaneToken } : {}),
    status: final,
  });
}

async function requireSucceededRecord(opts: {
  controlPlaneUrl: string;
  controlPlaneToken?: string;
  status: DeploymentControlPlaneStatus;
}) {
  const rejectionMessage = terminalControlPlaneRejectionMessage(opts.status);
  if (rejectionMessage) throw Object.assign(new Error(rejectionMessage), { status: opts.status });
  const record = await readFinalizedRecord({
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.controlPlaneToken ? { controlPlaneToken: opts.controlPlaneToken } : {}),
    deployRunId: String(opts.status.deployRunId || ""),
  });
  if (record.finalOutcome === "succeeded") return record;
  throw new Error(controlPlaneRecordFailureMessage(record));
}
