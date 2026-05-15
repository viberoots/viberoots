#!/usr/bin/env zx-wrapper
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import {
  readControlPlaneRecord,
  readControlPlaneStatus,
} from "./nixos-shared-host-control-plane-service-read";
import { handleCurrentStageStateReadRoute } from "./deployment-current-stage-state-service";
import { redactControlPlaneReadModel } from "./deployment-control-plane-read-redaction";

export type ControlPlaneReadRouteResult =
  | { handled: false }
  | { handled: true; statusCode: number; body: unknown };

function selector(searchParams: URLSearchParams) {
  const submissionId = searchParams.get("submissionId") || "";
  const deployRunId = searchParams.get("deployRunId") || "";
  return {
    ...(submissionId ? { submissionId } : {}),
    ...(deployRunId ? { deployRunId } : {}),
  };
}

export function isControlPlaneReadRoute(method: string, pathname: string): boolean {
  return (
    method === "GET" &&
    [
      "/api/v1/status",
      "/api/v1/records",
      "/api/v1/current-stage-state",
      "/api/v1/stage-history",
      "/api/v1/stage-state-audit",
    ].includes(pathname)
  );
}

export async function handleControlPlaneReadRoute(opts: {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  backend: NixosSharedHostControlPlaneBackendTarget;
}): Promise<ControlPlaneReadRouteResult> {
  if (opts.method === "GET" && opts.pathname === "/api/v1/status") {
    const status = await readControlPlaneStatus(opts.backend, selector(opts.searchParams));
    return status
      ? { handled: true, statusCode: 200, body: redactControlPlaneReadModel(status) }
      : { handled: true, statusCode: 404, body: { error: "submission not found" } };
  }
  if (opts.method === "GET" && opts.pathname === "/api/v1/records") {
    const record = await readControlPlaneRecord(opts.backend, selector(opts.searchParams));
    return record
      ? { handled: true, statusCode: 200, body: redactControlPlaneReadModel(record) }
      : { handled: true, statusCode: 404, body: { error: "record not found" } };
  }
  return await handleCurrentStageStateReadRoute(opts);
}
