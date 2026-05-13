#!/usr/bin/env zx-wrapper
import type { DeploymentCurrentStageState } from "./deployment-current-stage-state";
import type { DeploymentStageStateAuditEvent } from "./deployment-stage-state-audit";

const CONTROL_PLANE_REQUEST_TIMEOUT_MS = 15_000;

function authHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readStageJson<T>(opts: {
  url: URL;
  route: string;
  controlPlaneUrl: string;
  token?: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONTROL_PLANE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(opts.url, {
      headers: { ...authHeaders(opts.token) },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${CONTROL_PLANE_REQUEST_TIMEOUT_MS}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${opts.route} read failed for ${opts.controlPlaneUrl}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readNixosSharedHostCurrentStageStateViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  deploymentId?: string;
  environmentStage?: string;
}) {
  const url = new URL("/api/v1/current-stage-state", opts.controlPlaneUrl);
  if (opts.deploymentId) url.searchParams.set("deploymentId", opts.deploymentId);
  if (opts.environmentStage) url.searchParams.set("environmentStage", opts.environmentStage);
  return await readStageJson<DeploymentCurrentStageState | DeploymentCurrentStageState[]>({
    url,
    route: "/api/v1/current-stage-state",
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.token ? { token: opts.token } : {}),
  });
}

export async function readNixosSharedHostStageHistoryViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  deploymentId: string;
  environmentStage?: string;
}) {
  const url = new URL("/api/v1/stage-history", opts.controlPlaneUrl);
  url.searchParams.set("deploymentId", opts.deploymentId);
  if (opts.environmentStage) url.searchParams.set("environmentStage", opts.environmentStage);
  return await readStageJson<DeploymentCurrentStageState[]>({
    url,
    route: "/api/v1/stage-history",
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.token ? { token: opts.token } : {}),
  });
}

export async function readNixosSharedHostStageStateAuditViaService(opts: {
  controlPlaneUrl: string;
  token?: string;
  deploymentId: string;
  environmentStage?: string;
}) {
  const url = new URL("/api/v1/stage-state-audit", opts.controlPlaneUrl);
  url.searchParams.set("deploymentId", opts.deploymentId);
  if (opts.environmentStage) url.searchParams.set("environmentStage", opts.environmentStage);
  return await readStageJson<DeploymentStageStateAuditEvent[]>({
    url,
    route: "/api/v1/stage-state-audit",
    controlPlaneUrl: opts.controlPlaneUrl,
    ...(opts.token ? { token: opts.token } : {}),
  });
}
