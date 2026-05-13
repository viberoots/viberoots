#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getArgvTokens, getFlagStr, hasFlag } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import {
  localGitRevision,
  requiredDeploymentReviewedSourceRef,
  resolveReviewedSourceRevision,
} from "./deployment-reviewed-source-ref";

const execFileAsync = promisify(execFile);

function gitErrorDetail(error: unknown): string {
  const stderr =
    error && typeof error === "object" && typeof (error as { stderr?: unknown }).stderr === "string"
      ? String((error as { stderr: string }).stderr).trim()
      : "";
  if (stderr) return stderr;
  return error instanceof Error ? error.message : String(error);
}

function firstGitErrorLine(detail: string): string {
  return (
    String(detail || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || detail
  );
}

export type DeploymentAdmissionRequirementsForCli = {
  admission_policy: string;
  source_ref_policy: {
    stage: string;
    ref: string;
    kind: string;
  };
  allowed_refs: string[];
  required_checks: string[];
  required_approvals: string[];
  trusted_admission_reporters: string[];
  required_check_subject?: {
    kind: "git_commit";
    ref: string;
    sha: string;
  };
  admit: {
    relevant_for_workflow: boolean;
    authorization_required: "admission_reporter";
    deploy_flag: "--admit-and-deploy";
    evidence_only_flag: "--admit-only";
  };
};

async function listGitRemotes(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["remote"], { cwd: workspaceRoot });
    return String(stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function renderFetchReviewedRefCommand(workspaceRoot: string, ref: string): Promise<string> {
  const remotes = await listGitRemotes(workspaceRoot);
  const remote = remotes.includes("github")
    ? "github"
    : remotes.includes("origin")
      ? "origin"
      : remotes[0] || "<remote>";
  return `git fetch ${remote} ${ref}:${ref}`;
}

function currentDeployCommandArgs(deployment: DeploymentTarget): string[] {
  const raw = getArgvTokens();
  return hasFlag("deployment") ? raw : ["--deployment", deployment.label, ...raw];
}

export async function resolveDeploymentRequiredCheckSubject(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
  requestedSourceRef?: string;
  requestedSourceRevision?: string;
}) {
  try {
    const source = await resolveReviewedSourceRevision({
      workspaceRoot: opts.workspaceRoot,
      deployment: opts.deployment,
      resolveGitRevision: localGitRevision,
      ...(opts.requestedSourceRef ? { requestedSourceRef: opts.requestedSourceRef } : {}),
      ...(opts.requestedSourceRevision
        ? { requestedSourceRevision: opts.requestedSourceRevision }
        : {}),
    });
    return {
      kind: "git_commit" as const,
      ref: source.ref,
      sha: source.sha,
    };
  } catch (error) {
    const ref =
      opts.requestedSourceRef ||
      opts.deployment.lanePolicy.sourceRefPolicy[opts.deployment.environmentStage] ||
      "";
    const detail = firstGitErrorLine(gitErrorDetail(error));
    throw new Error(
      [
        `deployment source ref ${ref} is not available in this git workspace for ${opts.deployment.label}`,
        remotesMissingLine(await renderFetchReviewedRefCommand(opts.workspaceRoot, ref)),
        `Then retry: ${renderDeployCommand(currentDeployCommandArgs(opts.deployment))}`,
        "Or rerun with --admit-for-commit <sha> if you already know the reviewed commit.",
        `git detail: ${detail}`,
      ].join("\n"),
    );
  }
}

export async function deploymentAdmissionRequirementsForCli(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<DeploymentAdmissionRequirementsForCli> {
  const policySource = requiredDeploymentReviewedSourceRef(deployment);
  const source = resolveReviewedSourceRevision({
    workspaceRoot,
    deployment,
    resolveGitRevision: localGitRevision,
  }).catch(() => undefined);
  const requiredCheckSubject =
    deployment.admissionPolicy.requiredChecks.length > 0
      ? await source.then((entry) =>
          entry
            ? {
                kind: "git_commit" as const,
                ref: entry.ref,
                sha: entry.sha,
              }
            : undefined,
        )
      : undefined;
  const sourceRef = (await source) || policySource;
  return {
    admission_policy: deployment.admissionPolicyRef,
    source_ref_policy: {
      stage: deployment.environmentStage,
      ref: sourceRef.ref,
      kind: sourceRef.kind,
    },
    allowed_refs: [...deployment.admissionPolicy.allowedRefs],
    required_checks: [...deployment.admissionPolicy.requiredChecks],
    required_approvals: [...deployment.admissionPolicy.requiredApprovals],
    trusted_admission_reporters: [...deployment.lanePolicy.governance.trustedReporterIdentities],
    ...(requiredCheckSubject ? { required_check_subject: requiredCheckSubject } : {}),
    admit: {
      relevant_for_workflow: deployment.admissionPolicy.requiredChecks.length > 0,
      authorization_required: "admission_reporter",
      deploy_flag: "--admit-and-deploy",
      evidence_only_flag: "--admit-only",
    },
  };
}

export function missingAdmitValueMessage(
  deployment: DeploymentTarget,
  flag: "--admit-and-deploy" | "--admit-only",
): string {
  const requirements = {
    admission_policy: deployment.admissionPolicyRef,
    required_checks: [...deployment.admissionPolicy.requiredChecks],
  };
  const currentArgs = stripAdmissionShortcutArgs(deployment);
  return [
    `${flag} needs an explicit check name for this deployment.`,
    `deployment: ${deployment.label}`,
    `admission_policy: ${requirements.admission_policy}`,
    requirements.required_checks.length > 0
      ? `required_checks: ${requirements.required_checks.join(", ")}`
      : "required_checks: none",
    requirements.required_checks.length > 0
      ? `Run this instead: ${renderDeployCommand([
          ...currentArgs,
          flag,
          requirements.required_checks.join(","),
        ])}`
      : `Run this instead: ${renderDeployCommand(currentArgs)}`,
    `Inspect requirements only: ${renderDeployCommand(["--deployment", deployment.label, "--validate-only"])}`,
    "Discovering required check names does not grant admission_reporter authorization.",
  ].join("\n");
}

export function admitSubjectMismatchMessage(opts: {
  deployment: DeploymentTarget;
  actualSha: string;
  actualSource: "head" | "explicit";
  required: { ref: string; sha: string };
}): string {
  const currentArgs = stripAdmissionShortcutArgs(opts.deployment);
  const actualSourceLine =
    opts.actualSource === "head"
      ? `admission shortcut defaulted to local HEAD: ${opts.actualSha}`
      : `--admit-for-commit resolved to: ${opts.actualSha}`;
  return [
    actualSourceLine,
    `But this deploy currently requires checks for: ${opts.required.sha}`,
    `deployment_source_ref: ${opts.required.ref}`,
    "Make sure the deployment source ref is up to date and pushed before retrying.",
    `Run this instead: ${renderDeployCommand([
      ...currentArgs,
      "--admit-for-commit",
      opts.required.sha,
    ])}`,
    `Inspect requirements only: ${renderDeployCommand(["--deployment", opts.deployment.label, "--validate-only"])}`,
  ].join("\n");
}

function stripAdmissionShortcutArgs(deployment: DeploymentTarget): string[] {
  const raw = getArgvTokens();
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i] || "";
    if (arg === "--admit-and-deploy" || arg === "--admit-only") {
      const next = raw[i + 1] || "";
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--admit-and-deploy=") || arg.startsWith("--admit-only=")) continue;
    if (arg === "--admit-for-commit") {
      const next = raw[i + 1] || "";
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--admit-for-commit=")) continue;
    kept.push(arg);
  }
  return hasFlag("deployment") ? kept : ["--deployment", deployment.label, ...kept];
}

function renderDeployCommand(args: string[]): string {
  return ["deploy", ...args].join(" ");
}

function remotesMissingLine(fetchCommand: string): string {
  return fetchCommand.includes("<remote>")
    ? `Run this first (replace <remote> with your git remote): ${fetchCommand}`
    : `Run this first: ${fetchCommand}`;
}
