#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NixosSharedHostDeployment } from "./contract.ts";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence.ts";
import {
  buildRemoteArtifactStageArgv,
  buildRemoteCleanupScript,
  buildRemoteDeployScript,
  buildRemoteHostApplyScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgv,
  buildRemoteStagePrepareScript,
  type NixosSharedHostRemoteSmokeConnectOverride,
} from "./nixos-shared-host-remote-shell.ts";
import {
  createNixosSharedHostRemoteArtifactPath,
  type NixosSharedHostRemotePlan,
} from "./nixos-shared-host-remote-target.ts";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records.ts";
import type { NixosSharedHostHostApplySummary } from "./nixos-shared-host-host-apply.ts";

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
  remoteDeployResult: {
    runId: string;
    deployRunId: string;
    runClassification: string;
    finalOutcome: string;
    artifactIdentity?: string;
    publicUrl?: string;
    recordPath: string;
  };
  hostApply: {
    selectedMode: NixosSharedHostRemotePlan["hostApply"]["selectedMode"];
    result?: NixosSharedHostHostApplySummary;
  };
};

function commandFailure(step: string, result: CommandResult): Error {
  const details = [result.stderr.trim(), result.stdout.trim(), `exit=${result.exitCode}`]
    .filter(Boolean)
    .join("\n");
  return new Error(`${step}\n${details}`.trim());
}

function parseRemoteDeployResult(
  stdout: string,
): NixosSharedHostRemoteDeploySummary["remoteDeployResult"] {
  const parsed = JSON.parse(stdout) as Partial<
    NixosSharedHostRemoteDeploySummary["remoteDeployResult"]
  >;
  if (
    typeof parsed.runId !== "string" ||
    typeof parsed.deployRunId !== "string" ||
    typeof parsed.runClassification !== "string" ||
    typeof parsed.finalOutcome !== "string" ||
    typeof parsed.recordPath !== "string"
  ) {
    throw new Error(`remote deploy returned invalid JSON summary: ${stdout.trim()}`);
  }
  return {
    runId: parsed.runId,
    deployRunId: parsed.deployRunId,
    runClassification: parsed.runClassification,
    finalOutcome: parsed.finalOutcome,
    ...(typeof parsed.artifactIdentity === "string"
      ? { artifactIdentity: parsed.artifactIdentity }
      : {}),
    ...(typeof parsed.publicUrl === "string" ? { publicUrl: parsed.publicUrl } : {}),
    recordPath: parsed.recordPath,
  };
}

function parseRemoteHostApplyResult(stdout: string): NixosSharedHostHostApplySummary {
  const parsed = JSON.parse(stdout) as Partial<NixosSharedHostHostApplySummary>;
  if (
    (parsed.mode !== "switch" && parsed.mode !== "dry-run") ||
    typeof parsed.applied !== "boolean" ||
    !Array.isArray(parsed.command) ||
    typeof parsed.configTopology !== "string" ||
    typeof parsed.configRoot !== "string" ||
    typeof parsed.managedRoot !== "string" ||
    typeof parsed.statePath !== "string" ||
    typeof parsed.runtimeRoot !== "string" ||
    typeof parsed.recordsRoot !== "string" ||
    parsed.wiringState !== "wired"
  ) {
    throw new Error(`remote host apply returned invalid JSON summary: ${stdout.trim()}`);
  }
  return parsed as NixosSharedHostHostApplySummary;
}

async function runCommand(argv: string[]): Promise<CommandResult> {
  const [file, ...args] = argv;
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      encoding: "utf8",
      maxBuffer: TRANSPORT_MAX_BUFFER,
      env: process.env,
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

export async function runNixosSharedHostRemoteDeploy(opts: {
  deployment: NixosSharedHostDeployment;
  plan: NixosSharedHostRemotePlan;
  localArtifactDir: string;
  retainRemoteArtifact: boolean;
  admissionEvidence?: DeploymentAdmissionEvidence;
  smokeConnectOverride?: NixosSharedHostRemoteSmokeConnectOverride;
  hostApply: NixosSharedHostRemotePlan["hostApply"];
}): Promise<NixosSharedHostRemoteDeploySummary> {
  const executionId = createNixosSharedHostDeployRunId("remote");
  const stagedArtifactPath = createNixosSharedHostRemoteArtifactPath(opts.plan, executionId);
  let stagePrepared = false;
  let pendingError: Error | null = null;
  let remoteDeployResult: NixosSharedHostRemoteDeploySummary["remoteDeployResult"] | null = null;
  let hostApplyResult: NixosSharedHostHostApplySummary | undefined;
  const preflight = await runCommand(
    buildRemoteSshArgv(opts.plan.destination, buildRemoteRepoPreflightScript(opts.plan)),
  );
  if (preflight.exitCode !== 0) {
    throw commandFailure("remote repo preflight failed", preflight);
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
      buildRemoteArtifactStageArgv(
        opts.localArtifactDir,
        opts.plan.destination,
        stagedArtifactPath,
      ),
    );
    if (stage.exitCode !== 0) {
      throw commandFailure("remote artifact staging failed", stage);
    }
    const remoteDeploy = await runCommand(
      buildRemoteSshArgv(
        opts.plan.destination,
        buildRemoteDeployScript({
          plan: opts.plan,
          deploymentLabel: opts.deployment.label,
          remoteArtifactPath: stagedArtifactPath,
          ...(opts.admissionEvidence
            ? { admissionEvidenceJson: JSON.stringify(opts.admissionEvidence) }
            : {}),
          ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
        }),
      ),
    );
    if (remoteDeploy.exitCode !== 0) {
      throw commandFailure("remote deploy failed", remoteDeploy);
    }
    remoteDeployResult = parseRemoteDeployResult(remoteDeploy.stdout);
    if (opts.hostApply.selectedMode !== "skip") {
      const remoteHostApply = await runCommand(
        buildRemoteSshArgv(opts.plan.destination, buildRemoteHostApplyScript(opts.plan)),
      );
      if (remoteHostApply.exitCode !== 0) {
        const applyError = commandFailure("remote host apply failed", remoteHostApply);
        throw new Error(
          `${applyError.message}\nremote deploy record: ${remoteDeployResult.recordPath}`.trim(),
        );
      }
      hostApplyResult = parseRemoteHostApplyResult(remoteHostApply.stdout);
    }
  } catch (error) {
    pendingError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (stagePrepared && !opts.retainRemoteArtifact) {
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
  if (!remoteDeployResult) {
    throw new Error("remote deploy finished without a machine-readable summary");
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
    remoteDeployResult,
    hostApply: {
      selectedMode: opts.hostApply.selectedMode,
      ...(hostApplyResult ? { result: hostApplyResult } : {}),
    },
  };
}
