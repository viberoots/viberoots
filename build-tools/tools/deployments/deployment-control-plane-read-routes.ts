#!/usr/bin/env zx-wrapper
import { writeBackendControlPlaneReadAuditEvent } from "./deployment-control-plane-audit";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import { withBackendClient } from "./nixos-shared-host-control-plane-backend-db";
import {
  readControlPlaneRecord,
  readControlPlaneResourceGraph,
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
      "/api/v1/resource-graph",
    ].includes(pathname)
  );
}

export async function handleControlPlaneReadRoute(opts: {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  backend: NixosSharedHostControlPlaneBackendTarget;
  requestId?: string;
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
  if (opts.method === "GET" && opts.pathname === "/api/v1/resource-graph") {
    await writeResourceGraphReadAudit(opts.backend, opts.requestId);
    return {
      handled: true,
      statusCode: 200,
      body: await readControlPlaneResourceGraph(opts.backend),
    };
  }
  return await handleCurrentStageStateReadRoute(opts);
}

async function writeResourceGraphReadAudit(
  backend: NixosSharedHostControlPlaneBackendTarget,
  requestId: string | undefined,
) {
  if (!requestId) return;
  await withBackendClient(backend, async (client) => {
    await writeBackendControlPlaneReadAuditEvent({
      client,
      requestId,
      operation: "read.resource_graph",
      result: "success",
    });
  });
}
