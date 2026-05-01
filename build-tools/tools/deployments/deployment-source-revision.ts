#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeploymentTarget } from "./contract.ts";
import { requiredDeploymentStageBranch } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";

const execFileAsync = promisify(execFile);

async function gitRevision(workspaceRoot: string, revision: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", revision], { cwd: workspaceRoot });
    const resolved = String(stdout || "").trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

function expectedRevisionFromChecks(
  deployment: DeploymentTarget,
  admissionEvidence?: DeploymentAdmissionEvidence,
): string | undefined {
  const requiredChecks = new Set(deployment.admissionPolicy.requiredChecks);
  const subjects = Array.from(
    new Set(
      (admissionEvidence?.checks || [])
        .filter((check) => check.status === "passed" && requiredChecks.has(check.name))
        .map((check) => String(check.subject || "").trim())
        .filter(Boolean),
    ),
  );
  return subjects.length === 1 ? subjects[0] : undefined;
}

export function clientServiceAdmissionEvidence(
  admissionEvidence?: DeploymentAdmissionEvidence,
): DeploymentAdmissionEvidence | undefined {
  if (!admissionEvidence) return undefined;
  const { requestedBy: _requestedBy, ...evidence } = admissionEvidence;
  return evidence;
}

export async function resolveExpectedDeploymentSourceRevision(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  admissionEvidence?: DeploymentAdmissionEvidence;
}): Promise<string | undefined> {
  const evidence = clientServiceAdmissionEvidence(opts.admissionEvidence);
  const fromChecks = expectedRevisionFromChecks(opts.deployment, evidence);
  if (fromChecks) return fromChecks;
  return await gitRevision(opts.workspaceRoot, requiredDeploymentStageBranch(opts.deployment));
}
