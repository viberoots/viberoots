#!/usr/bin/env zx-wrapper
import { randomUUID } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import {
  handleControlPlaneReadRoute,
  isControlPlaneReadRoute,
} from "./deployment-control-plane-read-routes";
import { writeJson } from "./control-plane-http";
import { requireReviewedBearerToken } from "./deployment-control-plane-service-token";

export async function handleAuthenticatedControlPlaneReadRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  backend: NixosSharedHostControlPlaneBackendTarget;
  auth: { token?: string; localFixture?: boolean; env?: NodeJS.ProcessEnv };
}) {
  if (!isControlPlaneReadRoute(opts.request.method || "", opts.url.pathname)) return false;
  if (!requireReviewedBearerToken(opts.request, opts.response, opts.auth)) return true;
  const requestId = String(opts.request.headers["x-request-id"] || "").trim() || randomUUID();
  const route = await handleControlPlaneReadRoute({
    method: opts.request.method,
    pathname: opts.url.pathname,
    searchParams: opts.url.searchParams,
    backend: opts.backend,
    requestId,
  });
  if (!route.handled) throw new Error(`unhandled read route: ${opts.url.pathname}`);
  writeJson(opts.response, route.statusCode, route.body, {
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  return true;
}
