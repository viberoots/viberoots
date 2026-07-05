#!/usr/bin/env zx-wrapper
import http from "node:http";
import { writeJson } from "./control-plane-http";
import { readWorkerHeartbeatProbe } from "./control-plane-process-health";
import { requireReviewedBearerToken } from "./deployment-control-plane-service-token";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";

export async function handleWorkerHeartbeatRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  backend: NixosSharedHostControlPlaneBackendTarget;
  auth: { token?: string; localFixture?: boolean; env?: NodeJS.ProcessEnv };
  expectedInstanceId?: string;
}) {
  if (!requireReviewedBearerToken(opts.request, opts.response, opts.auth)) return;
  writeJson(
    opts.response,
    200,
    await readWorkerHeartbeatProbe(opts.backend, { expectedInstanceId: opts.expectedInstanceId }),
  );
}
