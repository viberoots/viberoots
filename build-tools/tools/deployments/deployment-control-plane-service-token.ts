#!/usr/bin/env zx-wrapper
import http from "node:http";
import { writeJson } from "./control-plane-http";
import { requestHasReviewedBearerToken } from "./nixos-shared-host-control-plane-service-auth";

export function requireReviewedBearerToken(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  opts: { token?: string; localFixture?: boolean; env?: NodeJS.ProcessEnv },
): boolean {
  const allowed = requestHasReviewedBearerToken({
    authorizationHeader: request.headers.authorization,
    serviceToken: opts.token,
    localFixture: opts.localFixture,
    env: opts.env,
  });
  if (!allowed) writeJson(response, 401, { error: "unauthorized" });
  return allowed;
}
