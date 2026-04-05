#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentTarget } from "./contract.ts";
import type {
  DeploymentChangeReason,
  DeploymentFromChangesPlan,
} from "./deployment-from-changes-selection.ts";

export type DeploymentBatchRunResult = {
  deploymentId: string;
  deploymentLabel: string;
  status: "succeeded" | "failed" | "blocked";
  reasons: DeploymentChangeReason[];
  blockedBy?: string[];
  error?: string;
  result?: {
    record: {
      deployRunId: string;
      operationKind: string;
      runClassification: string;
      finalOutcome: string;
      artifact?: { identity: string };
      parentRunId?: string;
      publicUrl?: string;
      controlPlane?: unknown;
      deployBatchId?: string;
    };
    recordPath: string;
  };
};

export type DeploymentFromChangesBatchResult = {
  mode: "from-changes";
  changedPaths: string[];
  directDeploymentIds: string[];
  deploymentOrder: string[];
  deployBatchId?: string;
  results: DeploymentBatchRunResult[];
};

export function createDeployBatchId(): string {
  return `batch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function reasonsFor(
  plan: DeploymentFromChangesPlan,
  deployment: DeploymentTarget,
): DeploymentChangeReason[] {
  return plan.reasonsByDeploymentId[deployment.deploymentId] || [];
}

function unsatisfiedHealthGates(
  deployment: DeploymentTarget,
  statusesByDeploymentId: Map<string, DeploymentBatchRunResult["status"]>,
): string[] {
  return deployment.prerequisites
    .filter((prerequisite) => prerequisite.mode === "health_gated")
    .filter((prerequisite) => statusesByDeploymentId.get(prerequisite.deploymentId) !== "succeeded")
    .map((prerequisite) => prerequisite.deploymentId)
    .sort();
}

export async function runDeploymentBatchFromChanges(opts: {
  plan: DeploymentFromChangesPlan;
  deployBatchId?: string;
  group: boolean;
  runDeployment: (
    deployment: DeploymentTarget,
    extra: { deployBatchId?: string },
  ) => Promise<DeploymentBatchRunResult["result"]>;
}): Promise<DeploymentFromChangesBatchResult> {
  const deployBatchId = opts.deployBatchId || (opts.group ? createDeployBatchId() : undefined);
  const statusesByDeploymentId = new Map<string, DeploymentBatchRunResult["status"]>();
  const results: DeploymentBatchRunResult[] = [];

  for (const deployment of opts.plan.selectedDeployments) {
    const blockedBy = unsatisfiedHealthGates(deployment, statusesByDeploymentId);
    if (blockedBy.length > 0) {
      const blocked: DeploymentBatchRunResult = {
        deploymentId: deployment.deploymentId,
        deploymentLabel: deployment.label,
        status: "blocked",
        reasons: reasonsFor(opts.plan, deployment),
        blockedBy,
        error: `health-gated prerequisites are not satisfied: ${blockedBy.join(", ")}`,
      };
      statusesByDeploymentId.set(deployment.deploymentId, blocked.status);
      results.push(blocked);
      continue;
    }
    try {
      const result = await opts.runDeployment(deployment, { deployBatchId });
      const succeeded: DeploymentBatchRunResult = {
        deploymentId: deployment.deploymentId,
        deploymentLabel: deployment.label,
        status: "succeeded",
        reasons: reasonsFor(opts.plan, deployment),
        result,
      };
      statusesByDeploymentId.set(deployment.deploymentId, succeeded.status);
      results.push(succeeded);
    } catch (error) {
      const failed: DeploymentBatchRunResult = {
        deploymentId: deployment.deploymentId,
        deploymentLabel: deployment.label,
        status: "failed",
        reasons: reasonsFor(opts.plan, deployment),
        error: error instanceof Error ? error.message : String(error),
        ...((error as any)?.record && (error as any)?.recordPath
          ? { result: { record: (error as any).record, recordPath: (error as any).recordPath } }
          : {}),
      };
      statusesByDeploymentId.set(deployment.deploymentId, failed.status);
      results.push(failed);
    }
  }

  return {
    mode: "from-changes",
    changedPaths: opts.plan.changedPaths,
    directDeploymentIds: opts.plan.directDeploymentIds,
    deploymentOrder: opts.plan.selectedDeployments.map((deployment) => deployment.deploymentId),
    ...(deployBatchId ? { deployBatchId } : {}),
    results,
  };
}
