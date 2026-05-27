#!/usr/bin/env zx-wrapper
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";
import type { ReviewedSourceCredentialFiles } from "./nixos-shared-host-reviewed-source-git";
import {
  type ControlPlaneWorkerHeartbeatStatus,
  writeWorkerHeartbeat,
} from "./control-plane-process-health";
import {
  createControlPlaneCorrelationId,
  type ControlPlaneProcessLogger,
  writeControlPlaneProcessLog,
} from "./control-plane-process-logging";
import { runNixosSharedHostControlPlaneWorkerOnce } from "./nixos-shared-host-control-plane-worker-loop";

type WorkerOnce = typeof runNixosSharedHostControlPlaneWorkerOnce;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startNixosSharedHostControlPlaneWorkerLoop(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  backendDatabaseUrl: string;
  workerId?: string;
  pollMs?: number;
  objectStore?: ControlPlaneArtifactStore;
  credentialDirectory?: ControlPlaneCredentialDirectory;
  reviewedSourceCredentials?: ReviewedSourceCredentialFiles;
  onError?: (error: unknown) => void;
  instanceId?: string;
  heartbeatMs?: number;
  logger?: ControlPlaneProcessLogger;
  correlationId?: string;
  runOnce?: WorkerOnce;
}) {
  let closed = false;
  let running = false;
  let activeRunAbort: AbortController | undefined;
  const pollMs = opts.pollMs ?? 100;
  const workerId = opts.workerId || `worker-${process.pid}`;
  const correlationId = opts.correlationId || createControlPlaneCorrelationId("worker");
  const log = (event: string, fields?: Record<string, unknown>, error?: unknown) =>
    writeControlPlaneProcessLog(opts.logger, {
      event,
      correlationId,
      mode: "worker",
      workerId,
      instanceId: opts.instanceId,
      fields,
      error,
    });
  let heartbeatChain = Promise.resolve();
  const heartbeat = (status: ControlPlaneWorkerHeartbeatStatus) =>
    (heartbeatChain = heartbeatChain
      .then(() =>
        writeWorkerHeartbeat(
          { recordsRoot: opts.recordsRoot, databaseUrl: opts.backendDatabaseUrl },
          { workerId, instanceId: opts.instanceId, status },
        ),
      )
      .catch(opts.onError || (() => {})));
  log("worker_starting", { pollMs });
  void heartbeat("starting");
  const tick = async () => {
    if (closed || running) return;
    running = true;
    const runAbort = new AbortController();
    activeRunAbort = runAbort;
    try {
      await heartbeat("running");
      while (!closed) {
        try {
          const claimed = await (opts.runOnce || runNixosSharedHostControlPlaneWorkerOnce)({
            workspaceRoot: opts.workspaceRoot,
            recordsRoot: opts.recordsRoot,
            backendDatabaseUrl: opts.backendDatabaseUrl,
            workerId,
            abortSignal: runAbort.signal,
            ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
            ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
            ...(opts.reviewedSourceCredentials
              ? { reviewedSourceCredentials: opts.reviewedSourceCredentials }
              : {}),
          });
          if (!claimed) break;
        } catch (error) {
          opts.onError?.(error);
          log("worker_error", undefined, error);
          break;
        }
      }
    } finally {
      if (activeRunAbort === runAbort) activeRunAbort = undefined;
      running = false;
    }
  };
  const timer = setInterval(tick, pollMs);
  const heartbeatTimer = setInterval(
    () => void heartbeat(closed ? "stopping" : "running"),
    opts.heartbeatMs ?? 1_000,
  );
  timer.unref?.();
  heartbeatTimer.unref?.();
  void tick();
  return {
    workerId,
    correlationId,
    close: async () => {
      closed = true;
      log("worker_stopping");
      clearInterval(timer);
      clearInterval(heartbeatTimer);
      activeRunAbort?.abort();
      await heartbeat("stopping");
      while (running) await sleep(25);
      await heartbeat("stopped");
      log("worker_stopped");
    },
  };
}
