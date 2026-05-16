#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { writeBackendControlPlaneReadAuditEvent } from "./deployment-control-plane-audit";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import { withBackendClient } from "./nixos-shared-host-control-plane-backend-db";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import { requestHasReviewedBearerToken } from "./nixos-shared-host-control-plane-service-auth";
import {
  createControlPlaneWebSession,
  publicControlPlaneAuthContext,
  publicControlPlaneWebSession,
  readControlPlaneWebSession,
} from "./deployment-control-plane-web-session";
import {
  readControlPlaneDeploymentDetail,
  readControlPlaneQueueSummary,
  readControlPlaneRuntimeStatus,
} from "./deployment-control-plane-read-model";
import {
  CONTROL_PLANE_WEB_UI_CSS,
  CONTROL_PLANE_WEB_UI_JS,
  controlPlaneWebUiHtml,
} from "./deployment-control-plane-web-ui";
import { writeJson } from "./control-plane-http";

export type ControlPlaneWebOptions = {
  basePath: string;
  enabled: boolean;
  backend: NixosSharedHostControlPlaneBackendTarget;
  objectStore?: ControlPlaneArtifactStore;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  instanceId?: string;
};

export async function handleControlPlaneWebRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  web: ControlPlaneWebOptions;
}): Promise<boolean> {
  const pathname = stripBasePath(opts.url.pathname, opts.web.basePath);
  if (pathname === null) return false;
  if (opts.request.method === "POST" && pathname === "/api/v1/web/session") {
    if (!hasReadAuth(opts.request, opts.web)) return unauthorized(opts.response);
    writeJson(
      opts.response,
      200,
      publicControlPlaneWebSession(await createControlPlaneWebSession(opts.web.backend)),
    );
    return true;
  }
  if (pathname.startsWith("/api/v1/read/")) return await handleReadApi({ ...opts, pathname });
  if (!opts.web.enabled || opts.request.method !== "GET") return false;
  return serveUiAsset(opts.response, opts.web.basePath, pathname);
}

async function handleReadApi(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  pathname: string;
  web: ControlPlaneWebOptions;
}) {
  if (!(await hasReadAuth(opts.request, opts.web))) return unauthorized(opts.response);
  if (opts.pathname === "/api/v1/read/status") {
    await writeReadAudit(opts, { operation: "read.status" });
    writeJson(opts.response, 200, await readControlPlaneRuntimeStatus(opts.web));
    return true;
  }
  if (opts.pathname === "/api/v1/read/queue") {
    await writeReadAudit(opts, { operation: "read.queue" });
    writeJson(opts.response, 200, await readControlPlaneQueueSummary(opts.web.backend));
    return true;
  }
  if (opts.pathname === "/api/v1/read/auth-context") {
    await writeReadAudit(opts, { operation: "read.auth_context" });
    writeJson(opts.response, 200, await readAuthContext(opts.request, opts.web));
    return true;
  }
  const deployment = opts.pathname.match(/^\/api\/v1\/read\/deployments\/([^/]+)$/);
  if (deployment) {
    const deploymentId = decodeURIComponent(deployment[1]);
    await writeReadAudit(opts, { operation: "read.deployment_detail", deploymentId });
    writeJson(
      opts.response,
      200,
      await readControlPlaneDeploymentDetail(opts.web.backend, deploymentId),
    );
    return true;
  }
  writeJson(opts.response, 404, { error: "read endpoint not found" });
  return true;
}

async function writeReadAudit(
  opts: {
    request: http.IncomingMessage;
    web: ControlPlaneWebOptions;
  },
  event: { operation: string; deploymentId?: string },
) {
  await withBackendClient(opts.web.backend, async (client) => {
    await writeBackendControlPlaneReadAuditEvent({
      client,
      requestId: requestIdFor(opts.request),
      operation: event.operation,
      deploymentId: event.deploymentId,
      result: "success",
    });
  });
}

async function hasReadAuth(request: http.IncomingMessage, opts: ControlPlaneWebOptions) {
  if (
    requestHasReviewedBearerToken({
      authorizationHeader: request.headers.authorization,
      serviceToken: opts.token,
      localFixture: opts.localFixture,
      env: opts.env,
    })
  ) {
    return true;
  }
  const sessionId = String(request.headers["x-vbr-control-plane-session"] || "").trim();
  return sessionId ? !!(await readControlPlaneWebSession(opts.backend, sessionId)) : false;
}

async function readAuthContext(request: http.IncomingMessage, opts: ControlPlaneWebOptions) {
  const sessionId = String(request.headers["x-vbr-control-plane-session"] || "").trim();
  const session = sessionId ? await readControlPlaneWebSession(opts.backend, sessionId) : null;
  return publicControlPlaneAuthContext(
    session || {
      principal: { kind: "service_token", principalId: "reviewed-service-token" },
      grants: { read: true, mutations: false, deployments: "authorized_scope" },
    },
  );
}

function serveUiAsset(response: http.ServerResponse, basePath: string, pathname: string): boolean {
  if (["/", "/status", "/queue", "/deployment"].includes(pathname)) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(controlPlaneWebUiHtml(basePath));
    return true;
  }
  if (pathname === "/assets/control-plane.css")
    return writeAsset(response, "text/css", CONTROL_PLANE_WEB_UI_CSS);
  if (pathname === "/assets/control-plane.js")
    return writeAsset(response, "text/javascript", CONTROL_PLANE_WEB_UI_JS);
  return false;
}

function writeAsset(response: http.ServerResponse, contentType: string, body: string): true {
  response.writeHead(200, { "content-type": `${contentType}; charset=utf-8` });
  response.end(body);
  return true;
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (basePath === "/") return pathname;
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

function requestIdFor(request: http.IncomingMessage): string {
  return String(request.headers["x-request-id"] || "").trim() || crypto.randomUUID();
}

function unauthorized(response: http.ServerResponse): true {
  writeJson(response, 401, { error: "unauthorized" });
  return true;
}
