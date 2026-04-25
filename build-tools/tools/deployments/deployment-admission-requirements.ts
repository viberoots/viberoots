#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFlagStr, hasFlag } from "../lib/cli.ts";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract.ts";

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
  allowed_refs: string[];
  required_checks: string[];
  required_approvals: string[];
  required_check_subject?: {
    kind: "git_commit";
    ref: string;
    sha: string;
  };
  mark_check_passed: {
    relevant_for_workflow: boolean;
    authorization_required: "admission_reporter";
  };
};

async function resolveGitRevision(workspaceRoot: string, revision: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", revision], { cwd: workspaceRoot });
  const resolved = String(stdout || "").trim();
  if (!resolved) throw new Error(`empty git revision for ${revision}`);
  return resolved;
}

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
  const raw = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  return hasFlag("deployment") ? raw : ["--deployment", deployment.label, ...raw];
}

export async function resolveDeploymentRequiredCheckSubject(opts: {
  workspaceRoot: string;
  deployment: DeploymentTarget;
}) {
  const ref = requiredDeploymentStageBranch(opts.deployment);
  try {
    return {
      kind: "git_commit" as const,
      ref,
      sha: await resolveGitRevision(opts.workspaceRoot, ref),
    };
  } catch (error) {
    const detail = firstGitErrorLine(gitErrorDetail(error));
    throw new Error(
      [
        `deployment source ref ${ref} is not available in this git workspace for ${opts.deployment.label}`,
        remotesMissingLine(await renderFetchReviewedRefCommand(opts.workspaceRoot, ref)),
        `Then retry: ${renderDeployCommand(currentDeployCommandArgs(opts.deployment))}`,
        "Or rerun with --mark-check-for-commit <sha> if you already know the reviewed commit.",
        `git detail: ${detail}`,
      ].join("\n"),
    );
  }
}

export async function deploymentAdmissionRequirementsForCli(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<DeploymentAdmissionRequirementsForCli> {
  const requiredCheckSubject =
    deployment.admissionPolicy.requiredChecks.length > 0
      ? await resolveDeploymentRequiredCheckSubject({
          workspaceRoot,
          deployment,
        })
      : undefined;
  return {
    admission_policy: deployment.admissionPolicyRef,
    allowed_refs: [...deployment.admissionPolicy.allowedRefs],
    required_checks: [...deployment.admissionPolicy.requiredChecks],
    required_approvals: [...deployment.admissionPolicy.requiredApprovals],
    ...(requiredCheckSubject ? { required_check_subject: requiredCheckSubject } : {}),
    mark_check_passed: {
      relevant_for_workflow: deployment.admissionPolicy.requiredChecks.length > 0,
      authorization_required: "admission_reporter",
    },
  };
}

export function missingMarkCheckPassedValueMessage(deployment: DeploymentTarget): string {
  const requirements = {
    admission_policy: deployment.admissionPolicyRef,
    required_checks: [...deployment.admissionPolicy.requiredChecks],
  };
  const currentArgs = stripMarkCheckPassedFromCurrentArgs(deployment);
  return [
    "--mark-check-passed needs an explicit check name for this deployment.",
    `deployment: ${deployment.label}`,
    `admission_policy: ${requirements.admission_policy}`,
    requirements.required_checks.length > 0
      ? `required_checks: ${requirements.required_checks.join(", ")}`
      : "required_checks: none",
    requirements.required_checks.length > 0
      ? `Run this instead: ${renderDeployCommand([
          ...currentArgs,
          "--mark-check-passed",
          requirements.required_checks.join(","),
        ])}`
      : `Run this instead: ${renderDeployCommand(currentArgs)}`,
    `Inspect requirements only: ${renderDeployCommand(["--deployment", deployment.label, "--validate-only"])}`,
    "Discovering required check names does not grant admission_reporter authorization.",
  ].join("\n");
}

export function markCheckSubjectMismatchMessage(opts: {
  deployment: DeploymentTarget;
  actualSha: string;
  actualSource: "head" | "explicit";
  required: { ref: string; sha: string };
}): string {
  const currentArgs = stripMarkCheckPassedFromCurrentArgs(opts.deployment);
  const actualSourceLine =
    opts.actualSource === "head"
      ? `--mark-check-passed defaulted to local HEAD: ${opts.actualSha}`
      : `--mark-check-for-commit resolved to: ${opts.actualSha}`;
  return [
    actualSourceLine,
    `But this deploy currently requires checks for: ${opts.required.sha}`,
    `deployment_source_ref: ${opts.required.ref}`,
    `Run this instead: ${renderDeployCommand([
      ...currentArgs,
      "--mark-check-for-commit",
      opts.required.sha,
    ])}`,
    `Inspect requirements only: ${renderDeployCommand(["--deployment", opts.deployment.label, "--validate-only"])}`,
  ].join("\n");
}

function stripMarkCheckPassedFromCurrentArgs(deployment: DeploymentTarget): string[] {
  const raw = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  const kept: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i] || "";
    if (arg === "--mark-check-passed") {
      const next = raw[i + 1] || "";
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--mark-check-passed=")) continue;
    if (arg === "--mark-check-for-commit") {
      const next = raw[i + 1] || "";
      if (next && !next.startsWith("--")) i += 1;
      continue;
    }
    if (arg.startsWith("--mark-check-for-commit=")) continue;
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
