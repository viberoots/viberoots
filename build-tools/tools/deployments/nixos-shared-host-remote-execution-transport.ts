#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requiredDeploymentStageBranch, type DeploymentTarget } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env.ts";
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import { runNixosSharedHostDirectServiceMutation } from "./nixos-shared-host-control-plane-service-front-door.ts";

const execFileAsync = promisify(execFile);
const TRANSPORT_MAX_BUFFER = 10 * 1024 * 1024;

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
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
    `Sync the reviewed deployment ref on the service-side repo, or rerun with --mark-check-for-commit ${requiredSubject} if ${requiredSubject} is intentionally the reviewed commit to deploy.`,
  ].join("\n");
}

export function remoteServiceSubmissionError(
  error: unknown,
  opts?: {
    deployment?: DeploymentTarget;
    admissionEvidence?: DeploymentAdmissionEvidence;
  },
) {
  const base = error instanceof Error ? error : new Error(String(error));
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
  return Object.assign(
    new Error(
      `remote service submission failed: ${augmentRemoteAdmissionMismatchMessage(base.message, opts)}${refs ? ` (${refs})` : ""}`,
    ),
    {
      ...(error && typeof error === "object" ? error : {}),
    },
  );
}
