#!/usr/bin/env zx-wrapper
import type {
  DeploymentControlPlaneRunActionResponse,
  DeploymentControlPlaneRunActionRequest,
  DeploymentControlPlaneStatus,
  DeploymentControlPlaneSubmitResponse,
} from "./deployment-control-plane-contract.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";

const ACTIVE_LIFECYCLE_STATES = new Set(["queued", "waiting_for_lock", "running", "cancelling"]);

function authHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function readNixosSharedHostControlPlaneStatusViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  submissionId?: string;
  deployRunId?: string;
}) {
  const url = new URL("/api/v1/status", opts.controlPlaneUrl);
  if (opts.submissionId) url.searchParams.set("submissionId", opts.submissionId);
  if (opts.deployRunId) url.searchParams.set("deployRunId", opts.deployRunId);
  return await readJson<DeploymentControlPlaneStatus>(
    await fetch(url, { headers: { ...authHeaders(opts.token) } }),
  );
}

export async function submitNixosSharedHostControlPlaneViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: NixosSharedHostControlPlaneSubmitRequest;
  pollMs?: number;
  timeoutMs?: number;
}) {
  const initial = await readJson<DeploymentControlPlaneSubmitResponse>(
    await fetch(new URL("/api/v1/submissions", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
  );
  if (!ACTIVE_LIFECYCLE_STATES.has(initial.lifecycleState)) {
    return { initial, final: initial };
  }
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let latest: DeploymentControlPlaneStatus = initial;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    latest = await readNixosSharedHostControlPlaneStatusViaService({
      controlPlaneUrl: opts.controlPlaneUrl,
      token: opts.token,
      submissionId: initial.submissionId,
    });
    if (!ACTIVE_LIFECYCLE_STATES.has(latest.lifecycleState)) {
      return { initial, final: latest };
    }
  }
  throw new Error(`timed out waiting for control-plane submission ${initial.submissionId}`);
}

export async function submitNixosSharedHostControlPlaneRunActionViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: DeploymentControlPlaneRunActionRequest;
}) {
  return await readJson<DeploymentControlPlaneRunActionResponse>(
    await fetch(new URL("/api/v1/run-actions", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
  );
}
