#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract.ts";
import type { DeploymentAdmissionPolicyEvaluation } from "./deployment-admission-evidence.ts";
import type { DeploymentRunRecordLike } from "./deployment-admission-records.ts";

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

async function readRecord(recordPath: string): Promise<DeploymentRunRecordLike | null> {
  try {
    return JSON.parse(await fs.readFile(recordPath, "utf8")) as DeploymentRunRecordLike;
  } catch {
    return null;
  }
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
        "no_longer_admitted",
        `shared control-plane approval expired while queued: ${approval.name}`,
      );
    }
  }
  for (const prerequisite of evaluation.prerequisites) {
    if (prerequisite.mode !== "health_gated") continue;
    const record = await readRecord(prerequisite.sourceRecordPath);
    const url = record?.healthUrl || record?.publicUrl;
    if (!url || !(await fetchHealthy(url))) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `health_gated prerequisite no longer passes fresh revalidation: ${prerequisite.deploymentId}`,
      );
    }
  }
}
