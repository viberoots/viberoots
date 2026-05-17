#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";
import { runNixosSharedHostExplicitRemoval } from "./nixos-shared-host-explicit-removal";
import type { NixosSharedHostGateEvaluator } from "./nixos-shared-host-progressive-execution";
import { runNixosSharedHostStaticDeploy } from "./nixos-shared-host-static-deploy";
import {
  acquireControlPlaneLock,
  readControlPlaneJson,
  writeControlPlaneJson,
} from "./nixos-shared-host-control-plane-store";
import { nixosSharedHostLockScopes } from "./nixos-shared-host-components";
import type { NixosSharedHostDeployRecord } from "./nixos-shared-host-records";
import { withWorkerDeploymentSecretRuntime } from "./deployment-secret-runtime-worker";
import { resolveNixosSharedHostAdmittedSecretReferences } from "./nixos-shared-host-admission-helpers";
import type { DeploymentSecretContext } from "./deployment-secret-context";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";

async function resolveWorkerAdmittedSecrets(opts: {
  snapshot: NixosSharedHostControlPlaneSnapshot;
  executionSnapshotPath: string;
  secretContext?: DeploymentSecretContext;
}) {
  if (!opts.snapshot.admittedContext) return;
  opts.snapshot.admittedContext = {
    ...opts.snapshot.admittedContext,
    admittedSecretReferences: await resolveNixosSharedHostAdmittedSecretReferences({
      deployment: opts.snapshot.deployment,
      admittedContext: opts.snapshot.admittedContext,
      ...(opts.secretContext ? { secretContext: opts.secretContext } : {}),
    }),
  };
  await writeControlPlaneJson(opts.executionSnapshotPath, opts.snapshot);
}

export async function runNixosSharedHostControlPlaneWorker(opts: {
  submissionPath: string;
  executionSnapshotPath: string;
  recordSubmissionPath?: string;
  recordExecutionSnapshotPath?: string;
  workspaceRoot?: string;
  workerId: string;
  fencingToken?: string;
  deployRunId?: string;
  progressiveRollout?: NixosSharedHostControlPlaneSnapshot["progressiveRollout"];
  gateEvaluator?: NixosSharedHostGateEvaluator;
  credentialDirectory?: ControlPlaneCredentialDirectory;
}): Promise<{ record: NixosSharedHostDeployRecord; recordPath: string }> {
  const snapshot = await readControlPlaneJson<NixosSharedHostControlPlaneSnapshot>(
    opts.executionSnapshotPath,
  );
  const authority = {
    kind: "control-plane-worker" as const,
    submissionId: snapshot.submissionId,
    submissionPath: opts.recordSubmissionPath || opts.submissionPath,
    workerId: opts.workerId,
    lockScope: snapshot.lockScope,
    ...(opts.fencingToken ? { fencingToken: opts.fencingToken } : {}),
    executionSnapshotPath: opts.recordExecutionSnapshotPath || opts.executionSnapshotPath,
  };
  return snapshot.action.kind === "deploy"
    ? await withWorkerDeploymentSecretRuntime(
        {
          workspaceRoot: opts.workspaceRoot || process.cwd(),
          deployment: snapshot.deployment,
          ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
        },
        async (runtime) => {
          await resolveWorkerAdmittedSecrets({
            snapshot,
            executionSnapshotPath: opts.executionSnapshotPath,
            ...(runtime.secretContext ? { secretContext: runtime.secretContext } : {}),
          });
          return await runNixosSharedHostStaticDeploy({
            deployment: snapshot.deployment,
            operationKind:
              snapshot.operationKind === "retry" ||
              snapshot.operationKind === "rollback" ||
              snapshot.operationKind === "promotion" ||
              snapshot.operationKind === "provision_only"
                ? snapshot.operationKind
                : "deploy",
            ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
            publishBehavior: snapshot.action.publishBehavior,
            ...(snapshot.action.publishInput
              ? snapshot.action.publishInput.kind === "exact-artifact"
                ? { artifact: snapshot.action.publishInput.artifact }
                : {
                    componentArtifacts: snapshot.action.publishInput.components,
                    compositeArtifactIdentity:
                      snapshot.action.publishInput.compositeArtifactIdentity,
                  }
              : {}),
            statePath: snapshot.paths.statePath,
            hostRoot: snapshot.paths.hostRoot,
            recordsRoot: snapshot.paths.recordsRoot,
            ...(snapshot.action.parentRunId ? { parentRunId: snapshot.action.parentRunId } : {}),
            ...(snapshot.action.releaseLineageId
              ? { releaseLineageId: snapshot.action.releaseLineageId }
              : {}),
            ...(snapshot.action.artifactLineageId
              ? { artifactLineageId: snapshot.action.artifactLineageId }
              : {}),
            ...(snapshot.action.recordedComponentResults
              ? { sourceComponentResults: snapshot.action.recordedComponentResults }
              : {}),
            ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
            ...(snapshot.admittedContext ? { admittedContext: snapshot.admittedContext } : {}),
            ...(snapshot.recordedReleaseActions
              ? { releaseActions: snapshot.recordedReleaseActions }
              : {}),
            ...(opts.progressiveRollout ? { progressiveRollout: opts.progressiveRollout } : {}),
            ...(snapshot.provisionerPlan ? { provisionerPlan: snapshot.provisionerPlan } : {}),
            ...(snapshot.paths.hostConfigPath
              ? { hostConfigPath: snapshot.paths.hostConfigPath }
              : {}),
            ...(snapshot.smokeConnectOverride
              ? { smokeConnectOverride: snapshot.smokeConnectOverride }
              : {}),
            ...(opts.gateEvaluator ? { gateEvaluator: opts.gateEvaluator } : {}),
            authority,
          });
        },
      )
    : await runNixosSharedHostExplicitRemoval({
        deployment: snapshot.deployment,
        statePath: snapshot.paths.statePath,
        hostRoot: snapshot.paths.hostRoot,
        recordsRoot: snapshot.paths.recordsRoot,
        ...(opts.deployRunId ? { deployRunId: opts.deployRunId } : {}),
        ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
        ...(snapshot.provisionerPlan ? { provisionerPlan: snapshot.provisionerPlan } : {}),
        ...(snapshot.paths.hostConfigPath ? { hostConfigPath: snapshot.paths.hostConfigPath } : {}),
        authority,
      });
}

export async function acquireNixosSharedHostControlPlaneLocks(
  recordsRoot: string,
  deployment: Parameters<typeof nixosSharedHostLockScopes>[0],
  opts?: {
    shouldAbort?: Parameters<typeof acquireControlPlaneLock>[2]["shouldAbort"];
  },
) {
  const releaseLocks: Array<() => Promise<void>> = [];
  const assertions: Array<() => Promise<void>> = [];
  const fencingTokens: string[] = [];
  try {
    for (const lockScope of nixosSharedHostLockScopes(deployment)) {
      const lock = await acquireControlPlaneLock(recordsRoot, lockScope, {
        ...(opts?.shouldAbort ? { shouldAbort: opts.shouldAbort } : {}),
      });
      releaseLocks.push(lock.release);
      assertions.push(lock.assertCurrentAuthority);
      fencingTokens.push(lock.fencingToken);
    }
  } catch (error) {
    for (const release of releaseLocks.reverse()) await release();
    throw error;
  }
  return {
    fencingToken: fencingTokens[0],
    assertCurrentAuthority: async () => {
      for (const assertCurrentAuthority of assertions) await assertCurrentAuthority();
    },
    release: async () => {
      for (const release of releaseLocks.reverse()) await release();
    },
  };
}
