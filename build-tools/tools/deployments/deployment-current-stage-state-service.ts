#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import {
  readControlPlaneCurrentStageState,
  readControlPlaneStageHistory,
} from "./nixos-shared-host-control-plane-service-read";

export type CurrentStageStateRouteResult =
  | { handled: false }
  | { handled: true; statusCode: number; body: unknown };

export async function handleCurrentStageStateReadRoute(opts: {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  backend: NixosSharedHostControlPlaneBackendTarget;
}): Promise<CurrentStageStateRouteResult> {
  if (opts.method === "GET" && opts.pathname === "/api/v1/current-stage-state") {
    const deploymentId = opts.searchParams.get("deploymentId") || "";
    const environmentStage = opts.searchParams.get("environmentStage") || "";
    const state =
      deploymentId && environmentStage
        ? await readControlPlaneCurrentStageState(opts.backend, { deploymentId, environmentStage })
        : null;
    return state
      ? { handled: true, statusCode: 200, body: state }
      : { handled: true, statusCode: 404, body: { error: "current stage state not found" } };
  }
  if (opts.method === "GET" && opts.pathname === "/api/v1/stage-history") {
    const deploymentId = opts.searchParams.get("deploymentId") || "";
    const environmentStage = opts.searchParams.get("environmentStage") || "";
    if (!deploymentId) {
      return { handled: true, statusCode: 400, body: { error: "deploymentId is required" } };
    }
    return {
      handled: true,
      statusCode: 200,
      body: await readControlPlaneStageHistory(opts.backend, {
        deploymentId,
        ...(environmentStage ? { environmentStage } : {}),
      }),
    };
  }
  return { handled: false };
}
