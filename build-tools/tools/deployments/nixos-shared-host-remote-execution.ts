#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment } from "./contract";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";
import type { DeploymentVaultRuntimeInputs } from "./deployment-vault-runtime-inputs";
import {
  buildRemoteArtifactStageArgvWithFallback,
  buildRemoteCleanupScript,
  buildRemoteRepoPreflightScript,
  buildRemoteSshArgvWithFallback,
  buildRemoteStageFinalizeScript,
  buildRemoteStagePrepareScript,
  type NixosSharedHostRemoteSmokeConnectOverride,
} from "./nixos-shared-host-remote-shell";
import {
  createNixosSharedHostRemoteArtifactPath,
  type NixosSharedHostRemotePlan,
} from "./nixos-shared-host-remote-target";
import { createNixosSharedHostDeployRunId } from "./nixos-shared-host-records";
import { runNixosSharedHostDirectServiceMutation } from "./nixos-shared-host-control-plane-service-front-door";
import {
  commandFailure,
  remoteServiceSubmissionError,
  requireServiceRecord,
  runCommand,
} from "./nixos-shared-host-remote-execution-transport";
import {
  createAndWaitForServiceOwnedAuthSession,
  shouldUseServiceOwnedInteractiveAuth,
} from "./deployment-service-auth-client";
import { requireServiceTokenFromEnv } from "./nixos-shared-host-service-client-config";
import { expectedNixosSharedHostArtifactIdentities } from "./deployment-artifact-binding";
import { stagedUploadTempPath } from "./nixos-shared-host-staged-artifact";

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

export async function runNixosSharedHostRemoteDeploy(opts: {
  workspaceRoot: string;
  deployment: NixosSharedHostDeployment;
  plan: NixosSharedHostRemotePlan;
  localArtifactDir: string;
  retainRemoteArtifact: boolean;
  vaultRuntimeInputs?: DeploymentVaultRuntimeInputs;
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
  const sshAuth = opts.plan.reviewedRemoteSshAuth;
  const expectedArtifactIdentities = await expectedNixosSharedHostArtifactIdentities({
    deployment: opts.deployment,
    artifactDir: opts.localArtifactDir,
  });
  const authSessionId = shouldUseServiceOwnedInteractiveAuth({
    deployment: opts.deployment,
    inputs: opts.vaultRuntimeInputs,
  })
    ? await createAndWaitForServiceOwnedAuthSession({
        controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
        ...(controlPlaneToken ? { controlPlaneToken } : {}),
        deployment: opts.deployment,
        operationKind: "deploy",
        inputs: opts.vaultRuntimeInputs,
      })
    : undefined;
  let stagePrepared = false;
  let pendingError: Error | null = null;
  let controlPlane: NixosSharedHostRemoteDeploySummary["controlPlane"] | null = null;
  const preflight = await runCommand(
    buildRemoteSshArgvWithFallback(
      opts.plan.destination,
      buildRemoteRepoPreflightScript(opts.plan),
      sshAuth,
    ),
  );
  if (preflight.exitCode !== 0) {
    throw commandFailure(
      `remote repo preflight over SSH failed for "${opts.plan.destination}" while checking ${opts.plan.remoteRepoPath}`,
      preflight,
    );
  }
  try {
    const prepare = await runCommand(
      buildRemoteSshArgvWithFallback(
        opts.plan.destination,
        buildRemoteStagePrepareScript(stagedArtifactPath),
        sshAuth,
      ),
    );
    if (prepare.exitCode !== 0) {
      throw commandFailure("remote artifact staging prep failed", prepare);
    }
    stagePrepared = true;
    const stage = await runCommand(
      buildRemoteArtifactStageArgvWithFallback(
        opts.localArtifactDir,
        opts.plan.destination,
        uploadPath,
        sshAuth,
      ),
    );
    if (stage.exitCode !== 0) {
      throw commandFailure("remote artifact staging failed", stage);
    }
    const finalize = await runCommand(
      buildRemoteSshArgvWithFallback(
        opts.plan.destination,
        buildRemoteStageFinalizeScript(stagedArtifactPath),
        sshAuth,
      ),
    );
    if (finalize.exitCode !== 0) {
      throw commandFailure("remote artifact staging finalize failed", finalize);
    }
    const record = requireServiceRecord(
      await runNixosSharedHostDirectServiceMutation({
        workspaceRoot: opts.workspaceRoot,
        controlPlaneUrl: opts.plan.serviceClient.controlPlaneUrl,
        ...(controlPlaneToken ? { controlPlaneToken } : {}),
        deployment: opts.deployment,
        operationKind: "deploy",
        ...(authSessionId ? { authSessionId } : {}),
        artifactDir: stagedArtifactPath,
        expectedArtifactIdentities,
        ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
      }).catch((error) => {
        throw remoteServiceSubmissionError(error, {
          deployment: opts.deployment,
          ...(opts.admissionEvidence ? { admissionEvidence: opts.admissionEvidence } : {}),
        });
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
        buildRemoteSshArgvWithFallback(
          opts.plan.destination,
          buildRemoteCleanupScript(stagedArtifactPath),
          sshAuth,
        ),
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
