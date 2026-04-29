#!/usr/bin/env zx-wrapper
import type {
  DeploymentControlPlaneRunActionResponse,
  DeploymentControlPlaneRunActionRequest,
  DeploymentControlPlaneStatus,
  DeploymentControlPlaneSubmitResponse,
  DeploymentControlPlaneAuthorization,
} from "./deployment-control-plane-contract.ts";
import type { DeploymentPrincipal } from "./deployment-admission-evidence.ts";
import type { NixosSharedHostControlPlaneSubmitRequest } from "./nixos-shared-host-control-plane-api-contract.ts";
import type {
  DeploymentArtifactChallengeRequest,
  DeploymentArtifactChallengeResponse,
} from "./deployment-artifact-binding.ts";
import type {
  DeploymentAuthLoginRequest,
  DeploymentAuthLoginResponse,
  DeploymentAuthSessionStatus,
} from "./deployment-auth-session-types.ts";

const ACTIVE_LIFECYCLE_STATES = new Set(["queued", "waiting_for_lock", "running", "cancelling"]);
const CONTROL_PLANE_REQUEST_TIMEOUT_MS = 15_000;

function authHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function fetchControlPlane(input: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTROL_PLANE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${CONTROL_PLANE_REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function responseErrorMessage(
  body: string,
  status: number,
  context?: { route?: string; controlPlaneUrl?: string },
): string {
  const trimmed = body.trim();
  let parsedError = "";
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      parsedError = parsed.error.trim();
    }
  } catch {}
  if (
    status === 404 &&
    parsedError === "not found" &&
    context?.route === "/api/v1/submission-challenges/artifact"
  ) {
    return `control-plane service does not expose ${context.route}; ${String(context.controlPlaneUrl || "").trim() || "the selected service"} may be routed to an older deployment-service build`;
  }
  if (!trimmed) return `request failed: ${status}`;
  if (parsedError) return parsedError;
  return trimmed;
}

async function readJson<T>(
  request: Promise<Response>,
  context?: { route?: string; controlPlaneUrl?: string },
): Promise<T> {
  let response: Response;
  try {
    response = await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`control-plane service unavailable: ${message}`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(responseErrorMessage(body, response.status, context));
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
    fetchControlPlane(url, { headers: { ...authHeaders(opts.token) } }),
    { route: "/api/v1/status", controlPlaneUrl: opts.controlPlaneUrl },
  );
}

export async function readNixosSharedHostControlPlaneRecordViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  submissionId?: string;
  deployRunId?: string;
}) {
  const url = new URL("/api/v1/records", opts.controlPlaneUrl);
  if (opts.submissionId) url.searchParams.set("submissionId", opts.submissionId);
  if (opts.deployRunId) url.searchParams.set("deployRunId", opts.deployRunId);
  return await readJson<any>(fetchControlPlane(url, { headers: { ...authHeaders(opts.token) } }), {
    route: "/api/v1/records",
    controlPlaneUrl: opts.controlPlaneUrl,
  });
}

export async function submitNixosSharedHostControlPlaneViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: NixosSharedHostControlPlaneSubmitRequest;
  pollMs?: number;
  timeoutMs?: number;
}) {
  const initial = await readJson<DeploymentControlPlaneSubmitResponse>(
    fetchControlPlane(new URL("/api/v1/submissions", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
    { route: "/api/v1/submissions", controlPlaneUrl: opts.controlPlaneUrl },
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

export async function createNixosSharedHostArtifactChallengeViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: DeploymentArtifactChallengeRequest;
}) {
  return await readJson<DeploymentArtifactChallengeResponse>(
    fetchControlPlane(new URL("/api/v1/submission-challenges/artifact", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
    {
      route: "/api/v1/submission-challenges/artifact",
      controlPlaneUrl: opts.controlPlaneUrl,
    },
  );
}

export async function submitNixosSharedHostControlPlaneRunActionViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: DeploymentControlPlaneRunActionRequest & {
    deployRunId?: string;
    authSessionId?: string;
    requestedBy?: DeploymentPrincipal;
    authorization?: DeploymentControlPlaneAuthorization;
  };
}) {
  return await readJson<DeploymentControlPlaneRunActionResponse>(
    fetchControlPlane(new URL("/api/v1/run-actions", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
    { route: "/api/v1/run-actions", controlPlaneUrl: opts.controlPlaneUrl },
  );
}

export async function createDeploymentAuthLoginViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  request: DeploymentAuthLoginRequest;
}) {
  return await readJson<DeploymentAuthLoginResponse>(
    fetchControlPlane(new URL("/api/v1/auth/login", opts.controlPlaneUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(opts.token),
      },
      body: JSON.stringify(opts.request),
    }),
    { route: "/api/v1/auth/login", controlPlaneUrl: opts.controlPlaneUrl },
  );
}

export async function readDeploymentAuthSessionViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  sessionId: string;
}) {
  const url = new URL("/api/v1/auth/session", opts.controlPlaneUrl);
  url.searchParams.set("sessionId", opts.sessionId);
  return await readJson<DeploymentAuthSessionStatus>(
    fetchControlPlane(url, { headers: { ...authHeaders(opts.token) } }),
    { route: "/api/v1/auth/session", controlPlaneUrl: opts.controlPlaneUrl },
  );
}

export async function waitForDeploymentAuthSessionViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  sessionId: string;
  pollMs?: number;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    const status = await readDeploymentAuthSessionViaService(opts);
    if (status.status !== "pending") return status;
    await new Promise((resolve) => setTimeout(resolve, opts.pollMs ?? 250));
  }
  throw new Error(`timed out waiting for auth session ${opts.sessionId}`);
}
