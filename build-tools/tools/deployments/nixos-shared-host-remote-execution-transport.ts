#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

export function remoteServiceSubmissionError(error: unknown) {
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
    new Error(`remote service submission failed: ${base.message}${refs ? ` (${refs})` : ""}`),
    {
      ...(error && typeof error === "object" ? error : {}),
    },
  );
}
