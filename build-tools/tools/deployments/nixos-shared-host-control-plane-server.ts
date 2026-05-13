#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract";
import {
  handleControlPlaneRunAction,
  handleControlPlaneSubmit,
  type ServiceRunActionRequest,
} from "./nixos-shared-host-control-plane-service-api";
import { handleControlPlaneArtifactChallenge } from "./nixos-shared-host-control-plane-service-challenge";
import {
  handleControlPlaneReadRoute,
  isControlPlaneReadRoute,
} from "./deployment-control-plane-read-routes";
import {
  createDeploymentAuthLoginSession,
  handleDeploymentAuthCallback,
  readPublicDeploymentAuthSession,
} from "./deployment-auth-session-service";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { createStaticWebappUploadSession } from "./static-webapp-upload-sessions";
import {
  assertReviewedServiceTokenConfigured,
  requestHasReviewedBearerToken,
} from "./nixos-shared-host-control-plane-service-auth";

const MAX_REQUEST_BODY_BYTES = 60 * 1024 * 1024;

async function readRawBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error("request body exceeds size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  return JSON.parse((await readRawBody(request)).toString("utf8")) as T;
}

function writeJson(response: http.ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2) + "\n");
}

function requireReviewedBearerToken(
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

export async function startNixosSharedHostControlPlaneServer(opts: {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backendDatabaseUrl: string;
  host?: string;
  port?: number;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  assertReviewedServiceTokenConfigured({
    serviceToken: opts.token,
    context: "nixos-shared-host control-plane service",
    localFixture: opts.localFixture,
    env: opts.env,
  });
  const backend = { recordsRoot: opts.paths.recordsRoot, databaseUrl: opts.backendDatabaseUrl };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/oidc/callback") {
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code || !state) {
          writeJson(response, 400, { error: "OIDC callback missing code or state" });
          return;
        }
        writeJson(
          response,
          200,
          await handleDeploymentAuthCallback({
            recordsRoot: opts.paths.recordsRoot,
            code,
            state,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/submissions") {
        writeJson(
          response,
          200,
          await handleControlPlaneSubmit(await readJsonBody(request), {
            workspaceRoot: opts.workspaceRoot,
            paths: opts.paths,
            backend,
            serviceToken: opts.token,
            requireArtifactBinding: true,
            authorizationHeader: request.headers.authorization,
            localFixture: opts.localFixture,
            env: opts.env,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/submission-challenges/artifact") {
        writeJson(
          response,
          200,
          await handleControlPlaneArtifactChallenge(await readJsonBody(request), {
            paths: opts.paths,
            backend,
            serviceToken: opts.token,
            authorizationHeader: request.headers.authorization,
            localFixture: opts.localFixture,
            env: opts.env,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/artifact-uploads/static-webapp") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        const submissionId = String(request.headers["x-vbr-submission-id"] || "").trim();
        if (!submissionId) {
          writeJson(response, 400, { error: "artifact upload requires x-vbr-submission-id" });
          return;
        }
        writeJson(
          response,
          200,
          await createStaticWebappUploadSession({
            recordsRoot: opts.paths.recordsRoot,
            submissionId,
            archiveBytes: await readRawBody(request),
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        writeJson(
          response,
          200,
          await createDeploymentAuthLoginSession({
            recordsRoot: opts.paths.recordsRoot,
            request: await readJsonBody(request),
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/auth/session") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        const sessionId = url.searchParams.get("sessionId") || "";
        const session = sessionId
          ? await readPublicDeploymentAuthSession(opts.paths.recordsRoot, sessionId)
          : undefined;
        if (!session) {
          writeJson(response, 404, { error: "auth session not found" });
          return;
        }
        writeJson(response, 200, session);
        return;
      }
      if (isControlPlaneReadRoute(request.method || "", url.pathname)) {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        const route = await handleControlPlaneReadRoute({
          method: request.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          backend,
        });
        if (!route.handled) throw new Error(`unhandled read route: ${url.pathname}`);
        writeJson(response, route.statusCode, route.body);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/run-actions") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        writeJson(
          response,
          200,
          await handleControlPlaneRunAction(await readJsonBody<ServiceRunActionRequest>(request), {
            backend,
            workspaceRoot: opts.workspaceRoot,
          }),
        );
        return;
      }
      writeJson(response, 404, { error: "not found" });
    } catch (error) {
      const statusCode = Number((error as any)?.statusCode) || 500;
      writeJson(response, statusCode, {
        error: redactDeploymentAuthText(error instanceof Error ? error.message : String(error)),
      });
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(opts.port || 0, opts.host || "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("failed to bind control-plane server");
  return {
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
