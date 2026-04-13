#!/usr/bin/env zx-wrapper
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import {
  approvalGrantIsValid,
  approvalSummaryFromGrant,
  readApprovalGrantRecord,
} from "./deployment-control-plane-approval.ts";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRunRecordLike } from "./deployment-admission-records.ts";
import { readBackendDeployRecordByDeployRunId } from "./nixos-shared-host-control-plane-backend.ts";

type RevalidationContext = {
  targetEnvironment?: {
    targetRef?: string;
    targetRevision?: string;
  };
  policyEvaluation?: DeploymentAdmissionPolicyEvaluation;
};

async function gitStdout(workspaceRoot: string, args: string[]): Promise<string> {
  const out = await $({ cwd: workspaceRoot, stdio: "pipe" })`git ${args}`.nothrow();
  if ((out as any).exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${workspaceRoot}`);
  }
  return String((out as any).stdout || "").trim();
}

async function readSharedBackendRecord(opts: {
  recordsRoot: string;
  backendDatabaseUrl: string;
  deployRunId: string;
}): Promise<DeploymentRunRecordLike | null> {
  return (await readBackendDeployRecordByDeployRunId(
    {
      recordsRoot: opts.recordsRoot,
      databaseUrl: opts.backendDatabaseUrl,
    },
    opts.deployRunId,
  )) as DeploymentRunRecordLike | null;
}

async function fetchHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function requirePolicyEvaluation(
  admittedContext: RevalidationContext,
): DeploymentAdmissionPolicyEvaluation {
  const evaluation = admittedContext.policyEvaluation;
  if (!evaluation) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "shared control-plane revalidation requires recorded policy evaluation",
    );
  }
  return evaluation;
}

export async function revalidateControlPlaneAdmission(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  admittedContext: RevalidationContext;
  recordsRoot?: string;
  backendDatabaseUrl?: string;
}): Promise<void> {
  const evaluation = requirePolicyEvaluation(opts.admittedContext);
  const targetRef =
    opts.admittedContext.targetEnvironment?.targetRef ||
    requiredDeploymentStageBranch(opts.deployment);
  const currentRevision = await gitStdout(opts.workspaceRoot, ["rev-parse", targetRef]);
  if (
    opts.admittedContext.targetEnvironment?.targetRevision &&
    currentRevision !== opts.admittedContext.targetEnvironment.targetRevision
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `shared control-plane target revision changed while queued: ${targetRef}`,
    );
  }
  const now = Date.now();
  for (const approval of evaluation.requiredApprovals) {
    if (approval.expiresAt && Date.parse(approval.expiresAt) < now) {
      throw new DeploymentAdmissionError(
        "approval_no_longer_valid",
        `shared control-plane approval expired while queued: ${approval.name}`,
      );
    }
    if (!approval.recordRef || !path.isAbsolute(approval.recordRef)) continue;
    const record = await readApprovalGrantRecord(approval.recordRef).catch(() => undefined);
    if (!record) {
      throw new DeploymentAdmissionError(
        "approval_no_longer_valid",
        `shared control-plane approval record disappeared while queued: ${approval.name}`,
      );
    }
    if (
      !approvalGrantIsValid({
        record,
        summary: approvalSummaryFromGrant(record, approval.recordRef),
      }) ||
      record.payloadFingerprint !== evaluation.binding.payloadFingerprint ||
      record.targetIdentity !== evaluation.binding.targetIdentity
    ) {
      throw new DeploymentAdmissionError(
        "approval_no_longer_valid",
        `shared control-plane approval no longer matches the admitted payload: ${approval.name}`,
      );
    }
  }
  for (const prerequisite of evaluation.prerequisites) {
    if (prerequisite.mode !== "health_gated") continue;
    const recordedUrl = prerequisite.healthUrl || prerequisite.publicUrl;
    if (!recordedUrl) {
      if (!prerequisite.sourceDeployRunId || !opts.recordsRoot || !opts.backendDatabaseUrl) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `health_gated prerequisite no longer passes fresh revalidation: ${prerequisite.deploymentId}`,
        );
      }
    }
    const record = recordedUrl
      ? null
      : await readSharedBackendRecord({
          recordsRoot: opts.recordsRoot,
          backendDatabaseUrl: opts.backendDatabaseUrl,
          deployRunId: prerequisite.sourceDeployRunId,
        });
    const url = recordedUrl || record?.healthUrl || record?.publicUrl;
    if (!url || !(await fetchHealthy(url))) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `health_gated prerequisite no longer passes fresh revalidation: ${prerequisite.deploymentId}`,
      );
    }
  }
}
