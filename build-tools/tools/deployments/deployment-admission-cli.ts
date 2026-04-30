#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { getFlagList, getFlagStr, hasFlag } from "../lib/cli.ts";
import type { DeploymentTarget } from "./contract.ts";
import {
  markCheckSubjectMismatchMessage,
  missingMarkCheckPassedValueMessage,
  resolveDeploymentRequiredCheckSubject,
} from "./deployment-admission-requirements.ts";
import { isCiSession } from "./deployment-credential-source-selection.ts";
import {
  normalizeAdmissionEvidence,
  type DeploymentAdmissionEvidence,
  type DeploymentCheckEvidence,
  type DeploymentCheckReportingKind,
} from "./deployment-admission-evidence.ts";

const execFileAsync = promisify(execFile);

function readMarkedPassedChecks(deployment?: DeploymentTarget): string[] {
  const checks = getFlagList("mark-check-passed")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (hasFlag("mark-check-passed") && checks.length === 0) {
    throw new Error(
      deployment
        ? missingMarkCheckPassedValueMessage(deployment)
        : "--mark-check-passed requires one or more check names",
    );
  }
  return Array.from(new Set(checks));
}

function readMarkedPassedCommitOverride(): string | undefined {
  if (!hasFlag("mark-check-for-commit")) return undefined;
  const value = getFlagStr("mark-check-for-commit", "").trim();
  if (!value) throw new Error("--mark-check-for-commit requires a non-empty commit SHA or git rev");
  return value;
}

async function resolveGitRevision(workspaceRoot: string, revision: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", revision], { cwd: workspaceRoot });
  const resolved = String(stdout || "").trim();
  if (!resolved) throw new Error(`empty git revision for ${revision}`);
  return resolved;
}

async function resolveMarkedPassedCheckSubject(
  workspaceRoot: string,
  revision?: string,
): Promise<string> {
  try {
    return await resolveGitRevision(workspaceRoot, revision || "HEAD");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      revision
        ? `--mark-check-for-commit requires a resolvable git revision (${revision}): ${detail}`
        : `--mark-check-passed requires a git workspace with a resolvable HEAD: ${detail}`,
    );
  }
}

function mergeCheckEvidence(
  existing: DeploymentCheckEvidence[] = [],
  inferred: DeploymentCheckEvidence[],
): DeploymentCheckEvidence[] {
  const merged = new Map<string, DeploymentCheckEvidence>();
  const key = (entry: DeploymentCheckEvidence) =>
    [
      entry.name,
      entry.subject,
      entry.deploymentId || "",
      entry.environmentStage || "",
      entry.admissionPolicyRef || "",
    ].join("\u0000");
  for (const entry of existing) merged.set(key(entry), entry);
  for (const entry of inferred) merged.set(key(entry), entry);
  return Array.from(merged.values());
}

function defaultCheckReportingKind(env: NodeJS.ProcessEnv): DeploymentCheckReportingKind {
  return isCiSession(env) ? "ci_pipeline" : "human_manual";
}

function annotateCheckReportingKind(
  evidence: DeploymentAdmissionEvidence | undefined,
  reportingKind: DeploymentCheckReportingKind,
): DeploymentAdmissionEvidence | undefined {
  if (!evidence?.checks?.length) return evidence;
  return {
    ...evidence,
    checks: evidence.checks.map((check) =>
      check.reportingKind ? check : { ...check, reportingKind },
    ),
  };
}

export async function resolveDeploymentAdmissionEvidence(
  opts: {
    deployment?: DeploymentTarget;
    workspaceRoot?: string;
  } = {},
): Promise<DeploymentAdmissionEvidence | undefined> {
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const evidenceJson = getFlagStr("admission-evidence-json", "").trim();
  const markedPassedChecks = readMarkedPassedChecks(opts.deployment);
  const markedPassedCommitOverride = readMarkedPassedCommitOverride();
  if (markedPassedCommitOverride && markedPassedChecks.length === 0) {
    throw new Error("--mark-check-for-commit requires --mark-check-passed");
  }
  const reportingKind = defaultCheckReportingKind(process.env);
  const baseEvidence = annotateCheckReportingKind(
    evidenceJson
      ? normalizeAdmissionEvidence(JSON.parse(await fsp.readFile(evidenceJson, "utf8")))
      : undefined,
    reportingKind,
  );
  if (evidenceJson && !baseEvidence) {
    throw new Error(`invalid --admission-evidence-json payload: ${evidenceJson}`);
  }
  if (markedPassedChecks.length === 0) return baseEvidence;
  const subject = await resolveMarkedPassedCheckSubject(workspaceRoot, markedPassedCommitOverride);
  if (opts.deployment && opts.deployment.admissionPolicy.requiredChecks.length > 0) {
    const required = await resolveDeploymentRequiredCheckSubject({
      workspaceRoot,
      deployment: opts.deployment,
    });
    if (required.sha !== subject) {
      throw new Error(
        markCheckSubjectMismatchMessage({
          deployment: opts.deployment,
          actualSha: subject,
          actualSource: markedPassedCommitOverride ? "explicit" : "head",
          required,
        }),
      );
    }
  }
  const checkedAt = new Date().toISOString();
  const deploymentScope = opts.deployment
    ? {
        deploymentId: opts.deployment.deploymentId,
        environmentStage: opts.deployment.environmentStage,
        admissionPolicyRef: opts.deployment.admissionPolicyRef,
      }
    : {};
  const inferredChecks = markedPassedChecks.map(
    (name): DeploymentCheckEvidence => ({
      name,
      subject,
      status: "passed",
      checkedAt,
      ...deploymentScope,
      recordRef: `manual-check://${name}`,
      reportingKind,
    }),
  );
  return {
    ...(baseEvidence || {}),
    checks: mergeCheckEvidence(baseEvidence?.checks, inferredChecks),
  };
}
