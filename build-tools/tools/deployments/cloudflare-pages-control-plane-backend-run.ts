#!/usr/bin/env zx-wrapper
import { runCloudflarePagesStaticDeploy } from "./cloudflare-pages-static-deploy";
import { lockWaitAbortReasonForSubmission } from "./deployment-control-plane-queue";
import { acquireBackendControlPlaneLock } from "./nixos-shared-host-control-plane-backend";
import { readControlPlaneJson } from "./nixos-shared-host-control-plane-store";
import { commitCloudflareBackendRecord } from "./cloudflare-pages-control-plane-backend-record-commit";
// prettier-ignore
import { persistCloudflareBackendStatus, type CloudflareBackendSubmissionLike } from "./cloudflare-pages-control-plane-backend-status";
import { executeCloudflarePagesBackendPreviewCleanup } from "./cloudflare-pages-control-plane-backend-preview-cleanup";
// prettier-ignore
import { cleanupWorkerDeploymentSecretRuntime, prepareWorkerDeploymentSecretRuntime } from "./deployment-secret-runtime-worker";
import { activateDeploymentSecretContext } from "./deployment-secret-context";
import {
  cloudflareBackendTimeouts,
  persistCloudflareBackendStep,
  prepareWorkerAdmittedSnapshot,
  updateCloudflareBackendStep,
  withStepTimeout,
  writeCloudflareBackendFailureRecord,
  type CloudflareBackendExecutionStep,
} from "./cloudflare-pages-control-plane-backend-execution";
import { executeCloudflarePagesBackendTargetTransition } from "./cloudflare-pages-control-plane-backend-transition";
import type { CloudflareBackendRunOpts } from "./cloudflare-pages-control-plane-backend-run-types";
export async function executeCloudflarePagesBackendSubmission(opts: CloudflareBackendRunOpts) {
  const submission = await readControlPlaneJson<CloudflareBackendSubmissionLike>(
    opts.submissionPath,
  );
  const snapshot = await readControlPlaneJson<any>(opts.executionSnapshotPath);
  const lock = await acquireBackendControlPlaneLock(opts.backend, snapshot.lockScope, {
    shouldAbort: async () => await lockWaitAbortReasonForSubmission(opts.submissionPath),
  });
  const assertAuthority = async () => {
    await lock.assertCurrentAuthority();
    await opts.assertCurrentAuthority?.();
  };
  try {
    const timeouts = cloudflareBackendTimeouts();
    let running: CloudflareBackendSubmissionLike = updateCloudflareBackendStep(
      {
        ...submission,
        lifecycleState: "running",
        workerId: opts.workerId,
      },
      "vault",
      { timeoutMs: timeouts.vaultMs },
    );
    const persistStep = async (
      step: CloudflareBackendExecutionStep,
      metadata: { mutationStep?: boolean; timeoutMs?: number } = {},
    ) => {
      running = updateCloudflareBackendStep(running, step, metadata);
      await assertAuthority();
      await persistCloudflareBackendStep({
        backend: opts.backend,
        submissionPath: opts.submissionPath,
        submissionRef: opts.submissionRef,
        executionSnapshotRef: opts.executionSnapshotRef,
        running,
      });
    };
    await assertAuthority();
    await persistCloudflareBackendStatus({
      backend: opts.backend,
      submissionPath: opts.submissionPath,
      submissionRef: opts.submissionRef,
      executionSnapshotRef: opts.executionSnapshotRef,
      submission: running,
    });
    try {
      const runtime = await withStepTimeout(
        "vault",
        timeouts.vaultMs,
        async () =>
          await prepareWorkerDeploymentSecretRuntime({
            workspaceRoot: opts.workspaceRoot,
            deployment: snapshot.deployment,
            timeoutMs: timeouts.vaultMs,
          }),
      );
      const restoreSecretContext = activateDeploymentSecretContext(runtime.secretContext);
      const result = await (async () => {
        try {
          return snapshot.action?.kind === "preview_cleanup"
            ? await (async () => {
                await persistStep("admission_revalidation");
                await prepareWorkerAdmittedSnapshot({
                  workspaceRoot: opts.workspaceRoot,
                  backend: opts.backend,
                  executionSnapshotPath: opts.executionSnapshotPath,
                  executionSnapshotRef: opts.executionSnapshotRef,
                  snapshot,
                  ...(runtime.secretContext ? { secretContext: runtime.secretContext } : {}),
                });
                await persistStep("preview_cleanup", {
                  mutationStep: true,
                  timeoutMs: timeouts.previewCleanupMs,
                });
                await assertAuthority();
                return await withStepTimeout(
                  "preview_cleanup",
                  timeouts.previewCleanupMs,
                  async () =>
                    await executeCloudflarePagesBackendPreviewCleanup({
                      recordsRoot: opts.recordsRoot,
                      workerId: opts.workerId,
                      snapshot,
                    }),
                );
              })()
            : snapshot.targetException
              ? await (async () => {
                  await persistStep("target_transition", { mutationStep: true });
                  await assertAuthority();
                  return await executeCloudflarePagesBackendTargetTransition({
                    recordsRoot: opts.recordsRoot,
                    workerId: opts.workerId,
                    running,
                    snapshot,
                  });
                })()
              : await (async () => {
                  await persistStep("admission_revalidation");
                  await prepareWorkerAdmittedSnapshot({
                    workspaceRoot: opts.workspaceRoot,
                    backend: opts.backend,
                    executionSnapshotPath: opts.executionSnapshotPath,
                    executionSnapshotRef: opts.executionSnapshotRef,
                    snapshot,
                    ...(runtime.secretContext ? { secretContext: runtime.secretContext } : {}),
                  });
                  return await runCloudflarePagesStaticDeploy({
                    workspaceRoot: opts.workspaceRoot,
                    deployment: snapshot.deployment,
                    artifact: snapshot.action.publishInput.artifact,
                    recordsRoot: opts.recordsRoot,
                    operationKind: snapshot.operationKind,
                    admittedContext: snapshot.admittedContext,
                    ...(snapshot.action.parentRunId
                      ? { parentRunId: snapshot.action.parentRunId }
                      : {}),
                    ...(snapshot.action.releaseLineageId
                      ? { releaseLineageId: snapshot.action.releaseLineageId }
                      : {}),
                    ...(snapshot.action.artifactLineageId
                      ? { artifactLineageId: snapshot.action.artifactLineageId }
                      : {}),
                    ...(snapshot.deployBatchId ? { deployBatchId: snapshot.deployBatchId } : {}),
                    ...(snapshot.action.publishMode
                      ? { publishMode: snapshot.action.publishMode }
                      : {}),
                    ...(snapshot.action.effectiveRunTarget
                      ? { effectiveRunTarget: snapshot.action.effectiveRunTarget }
                      : {}),
                    ...(snapshot.action.previewIdentitySelector
                      ? { previewIdentitySelector: snapshot.action.previewIdentitySelector }
                      : {}),
                    authority: {
                      kind: "control-plane-worker",
                      submissionId: snapshot.submissionId,
                      submissionPath: opts.submissionRef,
                      workerId: opts.workerId,
                      lockScope: snapshot.lockScope,
                      fencingToken: lock.fencingToken,
                      executionSnapshotPath: opts.executionSnapshotPath,
                    },
                    ...(snapshot.smokeConnectOverride
                      ? { smokeConnectOverride: snapshot.smokeConnectOverride }
                      : {}),
                    progress: {
                      onStepStart: async (step, metadata) => {
                        await persistStep(step, {
                          mutationStep: true,
                          ...(metadata?.timeoutMs ? { timeoutMs: metadata.timeoutMs } : {}),
                        });
                        await assertAuthority();
                      },
                    },
                    timeouts: {
                      publishMs: timeouts.publishMs,
                      ...(timeouts.smokeMs ? { smokeMs: timeouts.smokeMs } : {}),
                    },
                  });
                })();
        } finally {
          restoreSecretContext();
          await cleanupWorkerDeploymentSecretRuntime(runtime);
        }
      })();
      await assertAuthority();
      await commitCloudflareBackendRecord({
        backend: opts.backend,
        ...result,
        fencingToken: lock.fencingToken,
        expectedCurrentRunId: snapshot.expectedCurrentRunId,
      });
      await assertAuthority();
      await persistCloudflareBackendStatus({
        backend: opts.backend,
        submissionPath: opts.submissionPath,
        submissionRef: opts.submissionRef,
        executionSnapshotRef: opts.executionSnapshotRef,
        submission: {
          ...running,
          lifecycleState: "finished",
          completedAt: new Date().toISOString(),
          deployRunId: result.record.deployRunId,
          resultRecordPath: result.recordPath,
          finalOutcome: result.record.finalOutcome,
        } as any,
      });
    } catch (error) {
      const failure =
        (error as any)?.record && (error as any)?.recordPath
          ? { record: (error as any).record, recordPath: (error as any).recordPath }
          : await writeCloudflareBackendFailureRecord({
              recordsRoot: opts.recordsRoot,
              workerId: opts.workerId,
              submissionRef: opts.submissionRef,
              executionSnapshotPath: opts.executionSnapshotPath,
              running,
              snapshot,
              error,
            });
      await assertAuthority();
      await commitCloudflareBackendRecord({
        backend: opts.backend,
        ...failure,
        fencingToken: lock.fencingToken,
        expectedCurrentRunId: snapshot.expectedCurrentRunId,
      });
      await assertAuthority();
      await persistCloudflareBackendStatus({
        backend: opts.backend,
        submissionPath: opts.submissionPath,
        submissionRef: opts.submissionRef,
        executionSnapshotRef: opts.executionSnapshotRef,
        submission: {
          ...running,
          lifecycleState: "finished",
          completedAt: new Date().toISOString(),
          deployRunId: failure.record.deployRunId,
          resultRecordPath: failure.recordPath,
          finalOutcome: failure.record.finalOutcome,
        } as any,
      });
    }
  } finally {
    await lock.release();
  }
}
