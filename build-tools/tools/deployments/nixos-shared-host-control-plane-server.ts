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
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import { assertProductionArtifactStore } from "./control-plane-artifact-store";
import { checkControlPlaneReadiness, readWorkerHeartbeats } from "./control-plane-process-health";
import { assertReviewedServiceTokenConfigured } from "./nixos-shared-host-control-plane-service-auth";
import { readJsonBody, readRawBody, writeJson } from "./control-plane-http";
import { handleControlPlanePresentationRoutes } from "./nixos-shared-host-control-plane-presentation-routes";
import { requireReviewedBearerToken } from "./deployment-control-plane-service-token";
import { readControlPlaneImageMetadata } from "./control-plane-image-metadata";

export async function startNixosSharedHostControlPlaneServer(opts: {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backendDatabaseUrl: string;
  host?: string;
  port?: number;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  objectStore?: ControlPlaneArtifactStore;
  instanceId?: string;
  webUi?: { enabled: boolean; basePath: string };
  mcp?: { enabled: boolean; basePath: string };
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
        writeJson(response, 200, {
          ok: true,
          instanceId: opts.instanceId || "unknown",
          image: readControlPlaneImageMetadata(opts.env),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/readyz") {
        const readiness = await checkControlPlaneReadiness({
          backend,
          objectStore: opts.objectStore,
        });
        writeJson(response, readiness.ok ? 200 : 503, readiness);
        return;
      }
      if (
        await handleControlPlanePresentationRoutes({
          request,
          response,
          url,
          backend,
          objectStore: opts.objectStore,
          token: opts.token,
          localFixture: opts.localFixture,
          env: opts.env,
          instanceId: opts.instanceId,
          webUi: opts.webUi,
          mcp: opts.mcp,
        })
      ) {
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/worker-heartbeats") {
        if (!requireReviewedBearerToken(request, response, opts)) return;
        writeJson(response, 200, { workers: await readWorkerHeartbeats(backend) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/submissions") {
        assertProductionArtifactStore({
          localFixture: opts.localFixture,
          objectStore: opts.objectStore,
        });
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
            objectStore: opts.objectStore,
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
        assertProductionArtifactStore({
          localFixture: opts.localFixture,
          objectStore: opts.objectStore,
        });
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
            ...(opts.objectStore ? { objectStore: opts.objectStore } : {}),
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
