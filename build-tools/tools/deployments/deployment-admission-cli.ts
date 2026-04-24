#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { getFlagList, getFlagStr, hasFlag } from "../lib/cli.ts";
import { isCiSession } from "./deployment-credential-source-selection.ts";
import {
  normalizeAdmissionEvidence,
  type DeploymentAdmissionEvidence,
  type DeploymentCheckEvidence,
  type DeploymentCheckReportingKind,
} from "./deployment-admission-evidence.ts";

const execFileAsync = promisify(execFile);

function readMarkedPassedChecks(): string[] {
  const checks = getFlagList("mark-check-passed")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (hasFlag("mark-check-passed") && checks.length === 0) {
    throw new Error("--mark-check-passed requires one or more check names");
  }
  return Array.from(new Set(checks));
}

async function resolveWorkspaceHeadRevision(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
    const revision = String(stdout || "").trim();
    if (!revision) throw new Error("empty git revision");
    return revision;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `--mark-check-passed requires a git workspace with a resolvable HEAD: ${detail}`,
    );
  }
}

function mergeCheckEvidence(
  existing: DeploymentCheckEvidence[] = [],
  inferred: DeploymentCheckEvidence[],
): DeploymentCheckEvidence[] {
  const merged = new Map<string, DeploymentCheckEvidence>();
  for (const entry of existing) merged.set(`${entry.name}\u0000${entry.subject}`, entry);
  for (const entry of inferred) merged.set(`${entry.name}\u0000${entry.subject}`, entry);
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

export async function resolveDeploymentAdmissionEvidence(): Promise<
  DeploymentAdmissionEvidence | undefined
> {
  const workspaceRoot = process.cwd();
  const evidenceJson = getFlagStr("admission-evidence-json", "").trim();
  const markedPassedChecks = readMarkedPassedChecks();
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
  const subject = await resolveWorkspaceHeadRevision(workspaceRoot);
  const checkedAt = new Date().toISOString();
  const inferredChecks = markedPassedChecks.map(
    (name): DeploymentCheckEvidence => ({
      name,
      subject,
      status: "passed",
      checkedAt,
      recordRef: `manual-check://${name}`,
      reportingKind,
    }),
  );
  return {
    ...(baseEvidence || {}),
    checks: mergeCheckEvidence(baseEvidence?.checks, inferredChecks),
  };
}
