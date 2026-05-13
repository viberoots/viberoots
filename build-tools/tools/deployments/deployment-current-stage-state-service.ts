#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import {
  readControlPlaneCurrentStageState,
  readControlPlaneCurrentStageStates,
  readControlPlaneRollbackCandidates,
  readControlPlaneStageStateAuditEvents,
  readControlPlaneStageHistory,
} from "./nixos-shared-host-control-plane-service-read";
import {
  publicCurrentStageState,
  publicRollbackCandidate,
} from "./deployment-current-stage-state-public";

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
    if (!deploymentId && !environmentStage) {
      return {
        handled: true,
        statusCode: 400,
        body: { error: "deploymentId or environmentStage is required" },
      };
    }
    if (deploymentId && environmentStage) {
      const state = await readControlPlaneCurrentStageState(opts.backend, {
        deploymentId,
        environmentStage,
      });
      return state
        ? {
            handled: true,
            statusCode: 200,
            body: {
              ...publicCurrentStageState(state),
              rollbackCandidates: (
                await readControlPlaneRollbackCandidates(opts.backend, {
                  deploymentId,
                  environmentStage,
                })
              ).map(publicRollbackCandidate),
            },
          }
        : { handled: true, statusCode: 404, body: { error: "current stage state not found" } };
    }
    return {
      handled: true,
      statusCode: 200,
      body: (
        await readControlPlaneCurrentStageStates(opts.backend, {
          ...(deploymentId ? { deploymentId } : {}),
          ...(environmentStage ? { environmentStage } : {}),
        })
      ).map(publicCurrentStageState),
    };
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
      body: (
        await readControlPlaneStageHistory(opts.backend, {
          deploymentId,
          ...(environmentStage ? { environmentStage } : {}),
        })
      ).map(publicCurrentStageState),
    };
  }
  if (opts.method === "GET" && opts.pathname === "/api/v1/stage-state-audit") {
    const deploymentId = opts.searchParams.get("deploymentId") || "";
    const environmentStage = opts.searchParams.get("environmentStage") || "";
    if (!deploymentId) {
      return { handled: true, statusCode: 400, body: { error: "deploymentId is required" } };
    }
    return {
      handled: true,
      statusCode: 200,
      body: await readControlPlaneStageStateAuditEvents(opts.backend, {
        deploymentId,
        ...(environmentStage ? { environmentStage } : {}),
      }),
    };
  }
  return { handled: false };
}
