#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import {
  buildRemoteArtifactStageArgv,
  buildRemoteCleanupScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgv,
  buildRemoteStageFinalizeScript,
  buildRemoteStagePrepareScript,
  type NixosSharedHostRemoteSmokeConnectOverride,
} from "./nixos-shared-host-remote-shell.ts";
import {
  createNixosSharedHostRemoteArtifactPath,
  type NixosSharedHostRemotePlan,
} from "./nixos-shared-host-remote-target.ts";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records.ts";
import { runNixosSharedHostDirectServiceMutation } from "./nixos-shared-host-control-plane-service-front-door.ts";
import { requireServiceTokenFromEnv } from "./nixos-shared-host-service-client-config.ts";
import { expectedNixosSharedHostArtifactIdentities } from "./deployment-artifact-binding.ts";
import { redactDeploymentAuthText } from "./deployment-auth-redaction.ts";
import { stagedUploadTempPath } from "./nixos-shared-host-staged-artifact.ts";

const execFileAsync = promisify(execFile);
const TRANSPORT_MAX_BUFFER = 10 * 1024 * 1024;

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type NixosSharedHostRemoteDeploySummary = {
  executionMode: "remote-profile";
  deploymentId: string;
  deploymentLabel: string;
  profileName: string;
  destination: string;
  transportMode: "ssh";
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  localArtifactDir: string;
  stagedArtifactPath: string;
  stagedArtifactCleanup: "removed" | "retained";
  retentionRequested: boolean;
  controlPlane: {
    controlPlaneUrl: string;
    submissionId: string;
    lifecycleState: string;
    deployRunId: string;
    finalOutcome: string;
    record: any;
  };
};

function commandFailure(step: string, result: CommandResult): Error {
  const details = [result.stderr.trim(), result.stdout.trim(), `exit=${result.exitCode}`]
    .filter(Boolean)
    .join("\n");
  return new Error(redactDeploymentAuthText(`${step}\n${details}`.trim()));
}

async function runCommand(argv: string[]): Promise<CommandResult> {
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

function requireServiceRecord(
  serviceResult: Awaited<ReturnType<typeof runNixosSharedHostDirectServiceMutation>>,
) {
  if (serviceResult.kind !== "result") {
    throw new Error(
      `remote service submission did not produce a terminal record (lifecycle=${serviceResult.status.lifecycleState})`,
    );
  }
  return serviceResult.result.record;
}

function remoteServiceSubmissionError(error: unknown) {
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

export async function runNixosSharedHostRemoteDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  plan: NixosSharedHostRemotePlan;
  localArtifactDir: string;
  retainRemoteArtifact: boolean;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostRemoteSmokeConnectOverride;
}): Promise<NixosSharedHostRemoteDeploySummary> {
  const executionId = createNixosSharedHostDeployRunId("remote");
  const stagedArtifactPath = createNixosSharedHostRemoteArtifactPath(opts.plan, executionId);
  const uploadPath = stagedUploadTempPath(stagedArtifactPath);
  const controlPlaneToken = requireServiceTokenFromEnv(
    opts.plan.serviceClient.controlPlaneTokenEnv,
    `remote profile "${opts.plan.profileName}" deploy`,
  );
  const expectedArtifactIdentities = await expectedNixosSharedHostArtifactIdentities({
    deployment: opts.deployment,
    artifactDir: opts.localArtifactDir,
  });
  let stagePrepared = false;
  let pendingError: Error | null = null;
  let controlPlane: NixosSharedHostRemoteDeploySummary["controlPlane"] | null = null;
  const preflight = await runCommand(
    buildRemoteSshArgv(opts.plan.destination, buildRemoteRepoPreflightScript(opts.plan)),
  );
  if (preflight.exitCode !== 0) {
    throw commandFailure(
      `remote repo preflight over SSH failed for "${opts.plan.destination}" while checking ${opts.plan.remoteRepoPath}`,
      preflight,
    );
  }
  try {
    const prepare = await runCommand(
      buildRemoteSshArgv(opts.plan.destination, buildRemoteStagePrepareScript(stagedArtifactPath)),
    );
    if (prepare.exitCode !== 0) {
      throw commandFailure("remote artifact staging prep failed", prepare);
    }
    stagePrepared = true;
    const stage = await runCommand(
      buildRemoteArtifactStageArgv(opts.localArtifactDir, opts.plan.destination, uploadPath),
    );
    if (stage.exitCode !== 0) {
      throw commandFailure("remote artifact staging failed", stage);
    }
    const finalize = await runCommand(
      buildRemoteSshArgv(opts.plan.destination, buildRemoteStageFinalizeScript(stagedArtifactPath)),
    );
    if (finalize.exitCode !== 0) {
      throw commandFailure("remote artifact staging finalize failed", finalize);
    }
    const record = requireServiceRecord(
      await runNixosSharedHostDirectServiceMutation({
        controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
        ...(controlPlaneToken ? { controlPlaneToken } : {}),
        deployment: opts.deployment,
        operationKind: "deploy",
        artifactDir: stagedArtifactPath,
        expectedArtifactIdentities,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }).catch((error) => {
        throw remoteServiceSubmissionError(error);
      }),
    );
    controlPlane = {
      controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
      submissionId: String(record.controlPlane?.submissionId || ""),
      lifecycleState: "finished",
      deployRunId: String(record.deployRunId || ""),
      finalOutcome: String(record.finalOutcome || ""),
      record,
    };
  } catch (error) {
    pendingError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (stagePrepared && (!opts.retainRemoteArtifact || pendingError)) {
      const cleanup = await runCommand(
        buildRemoteSshArgv(opts.plan.destination, buildRemoteCleanupScript(stagedArtifactPath)),
      );
      if (cleanup.exitCode !== 0) {
        const cleanupError = commandFailure("remote staged artifact cleanup failed", cleanup);
        pendingError = pendingError
          ? new Error(`${pendingError.message}\n${cleanupError.message}`)
          : cleanupError;
      }
    }
  }
  if (pendingError) throw pendingError;
  if (!controlPlane) {
    throw new Error("remote service submission finished without a machine-readable summary");
  }
  return {
    executionMode: "remote-profile",
    deploymentId: opts.deployment.deploymentId,
    deploymentLabel: opts.deployment.label,
    profileName: opts.plan.profileName,
    destination: opts.plan.destination,
    transportMode: opts.plan.transportMode,
    remoteRepoPath: opts.plan.remoteRepoPath,
    remoteStatePath: opts.plan.remoteStatePath,
    remoteRuntimeRoot: opts.plan.remoteRuntimeRoot,
    remoteRecordsRoot: opts.plan.remoteRecordsRoot,
    localArtifactDir: opts.localArtifactDir,
    stagedArtifactPath,
    stagedArtifactCleanup: opts.retainRemoteArtifact ? "retained" : "removed",
    retentionRequested: opts.retainRemoteArtifact,
    controlPlane,
  };
}
