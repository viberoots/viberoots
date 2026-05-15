#!/usr/bin/env zx-wrapper
import type { DeploymentControlPlaneRunAction } from "./deployment-control-plane-contract";

export function nextRunActionLifecycleState(
  lifecycleState: string,
  action: DeploymentControlPlaneRunAction,
) {
  if (action === "approve") {
    return { lifecycleState, rejectionCode: "no_longer_admitted" as const };
  }
  if (action === "resume") {
    return lifecycleState === "paused"
      ? { lifecycleState: "running" as const }
      : { lifecycleState, rejectionCode: "not_resumable" as const };
  }
  if (action === "abort") {
    return lifecycleState === "paused"
      ? { lifecycleState: "finished" as const }
      : { lifecycleState, rejectionCode: "not_paused" as const };
  }
  if (
    lifecycleState === "pending_approval" ||
    lifecycleState === "queued" ||
    lifecycleState === "waiting_for_lock"
  ) {
    return {
      lifecycleState: "cancelled" as const,
      terminationReason: "cancelled" as const,
      completedAt: new Date().toISOString(),
    };
  }
  if (lifecycleState === "running" || lifecycleState === "cancelling") {
    return { lifecycleState: "cancelling" as const };
  }
  return { lifecycleState, rejectionCode: "no_longer_admitted" as const };
}

export function unsupportedBackendProgressiveRunAction(
  action: DeploymentControlPlaneRunAction,
): Error {
  return Object.assign(
    new Error(`backend control-plane service does not support progressive ${action} run actions`),
    {
      code: "backend_progressive_run_action_unsupported",
      statusCode: 409,
    },
  );
}
