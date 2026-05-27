#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import { promisify } from "node:util";
import { getFlagList, getFlagStr, hasFlag } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import { scrubControlPlaneChildEnv } from "./control-plane-process-env";
import {
  admitSubjectMismatchMessage,
  missingAdmitValueMessage,
  resolveDeploymentRequiredCheckSubject,
} from "./deployment-admission-requirements";
import { isCiSession } from "./deployment-credential-source-selection";
import {
  normalizeAdmissionEvidence,
  type DeploymentAdmissionEvidence,
  type DeploymentCheckEvidence,
  type DeploymentCheckReportingKind,
  type DeploymentReviewedSourceEvidence,
} from "./deployment-admission-evidence";

const execFileAsync = promisify(execFile);

type AdmissionShortcutMode = "admit-only" | "admit-and-deploy";

function assertNoLegacyAdmissionFlags() {
  if (hasFlag("mark-check-passed")) {
    throw new Error(
      "--mark-check-passed has been replaced by --admit-and-deploy. Use --admit-only when you want to emit admission evidence without deploying.",
    );
  }
  if (hasFlag("mark-check-for-commit")) {
    throw new Error("--mark-check-for-commit has been replaced by --admit-for-commit");
  }
}

export function hasAdmitOnlyFlag(): boolean {
  return hasFlag("admit-only");
}

export function hasAdmitAndDeployFlag(): boolean {
  return hasFlag("admit-and-deploy");
}

function readAdmissionShortcutMode(): AdmissionShortcutMode | undefined {
  const admitOnly = hasAdmitOnlyFlag();
  const admitAndDeploy = hasAdmitAndDeployFlag();
  if (admitOnly && admitAndDeploy) {
    throw new Error("--admit-only and --admit-and-deploy are mutually exclusive");
  }
  if (admitOnly) return "admit-only";
  if (admitAndDeploy) return "admit-and-deploy";
  return undefined;
}

function readAdmittedChecks(deployment?: DeploymentTarget): string[] {
  const mode = readAdmissionShortcutMode();
  if (!mode) return [];
  const flagName = mode === "admit-only" ? "admit-only" : "admit-and-deploy";
  const flag: "--admit-and-deploy" | "--admit-only" =
    flagName === "admit-only" ? "--admit-only" : "--admit-and-deploy";
  const checks = getFlagList(flagName)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (checks.length === 0) {
    throw new Error(
      deployment
        ? missingAdmitValueMessage(deployment, flag)
        : `${flag} requires one or more check names`,
    );
  }
  return Array.from(new Set(checks));
}

function readAdmitCommitOverride(): string | undefined {
  if (!hasFlag("admit-for-commit")) return undefined;
  const value = getFlagStr("admit-for-commit", "").trim();
  if (!value) throw new Error("--admit-for-commit requires a non-empty commit SHA or git rev");
  return value;
}

async function resolveGitRevision(workspaceRoot: string, revision: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", revision], {
    cwd: workspaceRoot,
    env: scrubControlPlaneChildEnv(),
  });
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
        ? `--admit-for-commit requires a resolvable git revision (${revision}): ${detail}`
        : `admission shortcuts require a git workspace with a resolvable HEAD: ${detail}`,
    );
  }
}

function commitRefForSha(value: string): string {
  return `commit:${value.toLowerCase()}`;
}

async function resolveAdmitReviewedSource(
  workspaceRoot: string,
  revision: string,
): Promise<DeploymentReviewedSourceEvidence> {
  const resolved = await resolveMarkedPassedCheckSubject(workspaceRoot, revision);
  const ref = /^commit:[0-9a-f]{40}$/i.test(revision)
    ? commitRefForSha(revision.slice("commit:".length))
    : /^[0-9a-f]{40}$/i.test(revision)
      ? commitRefForSha(resolved)
      : revision;
  return { ref, revision: resolved };
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

function checkReporterIdentity(
  env: NodeJS.ProcessEnv,
  deployment: DeploymentTarget | undefined,
): string {
  const explicit = String(env.VBR_DEPLOY_CHECK_REPORTER_IDENTITY || "").trim();
  if (explicit) return explicit;
  return deployment?.lanePolicy.governance.trustedReporterIdentities[0] || "human:manual";
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
  assertNoLegacyAdmissionFlags();
  const workspaceRoot = opts.workspaceRoot || process.cwd();
  const evidenceJson = getFlagStr("admission-evidence-json", "").trim();
  const admittedChecks = readAdmittedChecks(opts.deployment);
  const admitCommitOverride = readAdmitCommitOverride();
  if (admitCommitOverride && admittedChecks.length === 0) {
    throw new Error("--admit-for-commit requires --admit-and-deploy or --admit-only");
  }
  const reportingKind = defaultCheckReportingKind(process.env);
  const reporterIdentity = checkReporterIdentity(process.env, opts.deployment);
  const baseEvidence = annotateCheckReportingKind(
    evidenceJson
      ? normalizeAdmissionEvidence(JSON.parse(await fsp.readFile(evidenceJson, "utf8")))
      : undefined,
    reportingKind,
  );
  if (evidenceJson && !baseEvidence) {
    throw new Error(`invalid --admission-evidence-json payload: ${evidenceJson}`);
  }
  if (admittedChecks.length === 0) return baseEvidence;
  const reviewedSource = admitCommitOverride
    ? await resolveAdmitReviewedSource(workspaceRoot, admitCommitOverride)
    : undefined;
  const subject =
    reviewedSource?.revision || (await resolveMarkedPassedCheckSubject(workspaceRoot, undefined));
  if (opts.deployment && opts.deployment.admissionPolicy.requiredChecks.length > 0) {
    const required = await resolveDeploymentRequiredCheckSubject({
      workspaceRoot,
      deployment: opts.deployment,
      ...(reviewedSource?.ref ? { requestedSourceRef: reviewedSource.ref } : {}),
      ...(reviewedSource?.revision ? { requestedSourceRevision: reviewedSource.revision } : {}),
    });
    if (required.sha !== subject) {
      throw new Error(
        admitSubjectMismatchMessage({
          deployment: opts.deployment,
          actualSha: subject,
          actualSource: admitCommitOverride ? "explicit" : "head",
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
  const inferredChecks = admittedChecks.map(
    (name): DeploymentCheckEvidence => ({
      name,
      subject,
      status: "passed",
      checkedAt,
      ...deploymentScope,
      recordRef: `manual-check://${name}`,
      reportingKind,
      reporterIdentity,
    }),
  );
  return {
    ...(baseEvidence || {}),
    ...(reviewedSource ? { reviewedSource } : {}),
    checks: mergeCheckEvidence(baseEvidence?.checks, inferredChecks),
  };
}
