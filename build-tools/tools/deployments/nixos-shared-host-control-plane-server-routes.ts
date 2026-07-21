import type http from "node:http";
import { URL } from "node:url";
import { assertProductionArtifactStore } from "./control-plane-artifact-store";
import { readJsonBody, readRawBody, writeJson } from "./control-plane-http";
import { handleWorkerHeartbeatRoute } from "./control-plane-worker-heartbeat-route";
import {
  createDeploymentAuthLoginSession,
  readPublicDeploymentAuthSession,
} from "./deployment-auth-session-service";
import { handleDeploymentAuthCallbackRoute } from "./deployment-auth-callback-route";
import { requireReviewedBearerToken } from "./deployment-control-plane-service-token";
import { handleDeploymentRunActionRoute } from "./deployment-run-action-route";
import { handleControlPlaneArtifactChallenge } from "./nixos-shared-host-control-plane-service-challenge";
import { handleControlPlaneSubmit } from "./nixos-shared-host-control-plane-service-api";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import { handleControlPlanePresentationRoutes } from "./nixos-shared-host-control-plane-presentation-routes";
import { handleAuthenticatedControlPlaneReadRoute } from "./nixos-shared-host-control-plane-read-server";
import type { NixosSharedHostControlPlaneServerOptions } from "./nixos-shared-host-control-plane-server-options";
import { createStaticWebappUploadSession } from "./static-webapp-upload-sessions";

export async function handleNixosSharedHostControlPlaneRequest(args: {
  opts: NixosSharedHostControlPlaneServerOptions;
  backend: NixosSharedHostControlPlaneBackendTarget;
  request: http.IncomingMessage;
  response: http.ServerResponse;
}) {
  const { opts, backend, request, response } = args;
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (
    await handleDeploymentAuthCallbackRoute({
      request,
      response,
      url,
      callbackPath: opts.authProvider?.callback.externalPath || "/oidc/callback",
      recordsRoot: opts.paths.recordsRoot,
      backend,
    })
  )
    return;
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
  )
    return;
  if (request.method === "GET" && url.pathname === "/api/v1/worker-heartbeats") {
    await handleWorkerHeartbeatRoute({
      request,
      response,
      backend,
      auth: opts,
      expectedInstanceId: opts.instanceId,
    });
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
        miniMigrationPreflight: opts.miniMigrationPreflight,
        authProvider: opts.authProvider,
        ...(opts.reviewedSourceCredentials
          ? { reviewedSourceCredentials: opts.reviewedSourceCredentials }
          : {}),
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
        backend,
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
        backend,
        request: await readJsonBody(request),
        authProvider: opts.authProvider,
      }),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/auth/session") {
    if (!requireReviewedBearerToken(request, response, opts)) return;
    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sessionId
      ? await readPublicDeploymentAuthSession(opts.paths.recordsRoot, sessionId, backend)
      : undefined;
    if (!session) {
      writeJson(response, 404, { error: "auth session not found" });
      return;
    }
    writeJson(response, 200, session);
    return;
  }
  if (
    await handleAuthenticatedControlPlaneReadRoute({
      request,
      response,
      url,
      backend,
      auth: { token: opts.token, localFixture: opts.localFixture, env: opts.env },
    })
  )
    return;
  if (
    await handleDeploymentRunActionRoute({
      request,
      response,
      url,
      backend,
      workspaceRoot: opts.workspaceRoot,
      token: opts.token,
      localFixture: opts.localFixture,
      env: opts.env,
      authProvider: opts.authProvider,
    })
  )
    return;
  writeJson(response, 404, { error: "not found" });
}
