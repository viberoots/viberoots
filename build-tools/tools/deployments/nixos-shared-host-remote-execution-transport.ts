#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import { deploymentAuthMissingGrantHint, type DeploymentAuthRole } from "./deployment-auth-groups";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { runNixosSharedHostDirectServiceMutation } from "./nixos-shared-host-control-plane-service-front-door";

const execFileAsync = promisify(execFile);
const TRANSPORT_MAX_BUFFER = 10 * 1024 * 1024;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ServiceInstanceLike = {
  hostname?: string;
  workspaceRoot?: string;
  gitHead?: string;
  reviewedRef?: string;
  reviewedRepository?: string;
  reviewedRemoteName?: string;
  reviewedRemoteUrl?: string;
};

export function commandFailure(step: string, result: CommandResult): Error {
  const details = [result.stderr.trim(), result.stdout.trim(), `exit=${result.exitCode}`]
    .filter(Boolean)
    .join("\n");
  return new Error(redactDeploymentAuthText(`${step}\n${details}`.trim()));
}

export async function runCommand(argv: string[]): Promise<CommandResult> {
  const [file, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: TRANSPORT_MAX_BUFFER,
      env: scrubDeploymentSecretEnv(),
    });
    return { exitCode: 0, stdout: String(stdout || ""), stderr: String(stderr || "") };
  } catch (error: any) {
    return {
      exitCode:
        typeof error?.code === "number"
          ? error.code
          : typeof error?.exitCode === "number"
            ? error.exitCode
            : 1,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
    };
  }
}

export function requireServiceRecord(
  serviceResult: Awaited<ReturnType<typeof runNixosSharedHostDirectServiceMutation>>,
) {
  if (serviceResult.kind !== "result") {
    throw new Error(
      `remote service submission did not produce a terminal record (lifecycle=${serviceResult.status.lifecycleState})`,
    );
  }
  return serviceResult.result.record;
}

function augmentRemoteAdmissionMismatchMessage(
  baseMessage: string,
  opts?: {
    deployment?: DeploymentTarget;
    admissionEvidence?: DeploymentAdmissionEvidence;
  },
): string {
  const match = baseMessage.match(
    /protected\/shared admission requires check (\S+) for subject\(s\) ([0-9a-f]{7,40})/,
  );
  if (!match) return baseMessage;
  const checkName = match[1] || "";
  const requiredSubject = match[2] || "";
  const submittedSubjects = Array.from(
    new Set(
      (opts?.admissionEvidence?.checks || [])
        .filter((check) => check.status === "passed" && check.name === checkName)
        .map((check) => String(check.subject || "").trim())
        .filter(Boolean),
    ),
  );
  const mismatchedSubjects = submittedSubjects.filter((subject) => subject !== requiredSubject);
  if (mismatchedSubjects.length === 0) return baseMessage;
  const deploymentSourceRef = opts?.deployment
    ? requiredDeploymentStageBranch(opts.deployment)
    : undefined;
  const submittedLine =
    mismatchedSubjects.length === 1
      ? `this client submitted passed ${checkName} for commit ${mismatchedSubjects[0]}`
      : `this client submitted passed ${checkName} for commits ${mismatchedSubjects.join(", ")}`;
  return [
    `protected/shared admission requires check ${checkName} for commit ${requiredSubject}, but ${submittedLine}.`,
    ...(deploymentSourceRef ? [`deployment_source_ref: ${deploymentSourceRef}`] : []),
    "This usually means the remote control-plane repo state does not match your local git workspace.",
    "Make sure the deployment branch is up to date and pushed before retrying.",
    `Rerun with --admit-for-commit ${requiredSubject} if ${requiredSubject} is intentionally the reviewed commit to deploy.`,
  ].join("\n");
}

function rewriteLegacyMissingGrantMessage(
  baseMessage: string,
  deployment?: DeploymentTarget,
): string {
  if (!deployment) return baseMessage;
  const principalId = baseMessage.match(/^principal (\S+)/)?.[1];
  const role = baseMessage.match(/missing (submitter|approver|admission_reporter) grant/)?.[1] as
    | DeploymentAuthRole
    | undefined;
  const prefix = baseMessage.match(
    /^(principal \S+ is not authorized [\s\S]*?: missing (submitter|approver|admission_reporter) grant)(?:;[\s\S]*)?$/,
  )?.[1];
  if (!principalId || !role || !prefix) return baseMessage;
  return `${prefix};${deploymentAuthMissingGrantHint({
    deployment,
    role,
    principalId,
  })}`;
}

function serviceInstanceFrom(error: unknown): ServiceInstanceLike | undefined {
  const status = (error as any)?.status;
  const record = (error as any)?.record;
  return status?.serviceInstance || record?.controlPlane?.serviceInstance;
}

function serviceInstanceLines(instance: ServiceInstanceLike | undefined): string[] {
  if (!instance) return [];
  return [
    instance.hostname ? `service_hostname: ${instance.hostname}` : "",
    instance.workspaceRoot ? `service_workspace_root: ${instance.workspaceRoot}` : "",
    instance.gitHead ? `service_git_head: ${instance.gitHead}` : "",
    instance.reviewedRef ? `service_reviewed_ref: ${instance.reviewedRef}` : "",
    instance.reviewedRepository
      ? `service_reviewed_repository: ${instance.reviewedRepository}`
      : "",
    instance.reviewedRemoteName ? `service_reviewed_remote: ${instance.reviewedRemoteName}` : "",
    instance.reviewedRemoteUrl ? `service_reviewed_remote_url: ${instance.reviewedRemoteUrl}` : "",
  ].filter(Boolean);
}

export function remoteServiceSubmissionError(
  error: unknown,
  opts?: {
    deployment?: DeploymentTarget;
    admissionEvidence?: DeploymentAdmissionEvidence;
  },
) {
  const base = error instanceof Error ? error : new Error(String(error));
  const normalizedBase = rewriteLegacyMissingGrantMessage(base.message, opts?.deployment);
  const record = (error as any)?.record;
  const status = (error as any)?.status;
  const refs = [
    typeof status?.submissionId === "string" && status.submissionId
      ? `submission=${status.submissionId}`
      : null,
    typeof record?.deployRunId === "string" && record.deployRunId
      ? `deployRunId=${record.deployRunId}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const serviceInstance = serviceInstanceFrom(error);
  const serviceLines = serviceInstanceLines(serviceInstance);
  return Object.assign(
    new Error(
      [
        `remote service submission failed: ${augmentRemoteAdmissionMismatchMessage(normalizedBase, opts)}`,
        ...serviceLines,
        ...(refs ? [refs] : []),
      ].join("\n"),
    ),
    {
      ...(error && typeof error === "object" ? error : {}),
    },
  );
}
