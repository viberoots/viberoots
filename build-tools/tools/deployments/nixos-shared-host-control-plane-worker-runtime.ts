#!/usr/bin/env zx-wrapper
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { ControlPlaneCredentialDirectory } from "./control-plane-credentials";
import type { ReviewedSourceCredentialFiles } from "./nixos-shared-host-reviewed-source-git";
import {
  type ControlPlaneWorkerHeartbeatStatus,
  writeWorkerHeartbeat,
} from "./control-plane-process-health";
import { runNixosSharedHostControlPlaneWorkerOnce } from "./nixos-shared-host-control-plane-worker-loop";

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
}) {
  let closed = false;
  let running = false;
  const pollMs = opts.pollMs ?? 100;
  const workerId = opts.workerId || `worker-${process.pid}`;
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
  const tick = async () => {
    if (closed || running) return;
    running = true;
    try {
      await heartbeat("running");
      while (!closed) {
        try {
          const claimed = await runNixosSharedHostControlPlaneWorkerOnce({
            workspaceRoot: opts.workspaceRoot,
            recordsRoot: opts.recordsRoot,
            backendDatabaseUrl: opts.backendDatabaseUrl,
            workerId,
            ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
            ...(opts.credentialDirectory ? { credentialDirectory: opts.credentialDirectory } : {}),
            ...(opts.reviewedSourceCredentials
              ? { reviewedSourceCredentials: opts.reviewedSourceCredentials }
              : {}),
          });
          if (!claimed) break;
        } catch (error) {
          opts.onError?.(error);
          break;
        }
      }
    } finally {
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
    close: async () => {
      closed = true;
      clearInterval(timer);
      clearInterval(heartbeatTimer);
      await heartbeat("stopping");
      while (running) await sleep(25);
      await heartbeat("stopped");
    },
  };
}
