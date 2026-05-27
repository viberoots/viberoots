#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import type { DeploymentAuthProviderConfig } from "./deployment-auth-provider-config";
import { handleControlPlaneRunAction } from "./deployment-control-plane-run-action-api";
import { readJsonBody, writeJson } from "./control-plane-http";
import { requestHasReviewedBearerToken } from "./nixos-shared-host-control-plane-service-auth";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import type { ServiceRunActionRequest } from "./nixos-shared-host-control-plane-service-api";

export async function handleDeploymentRunActionRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  backend: NixosSharedHostControlPlaneBackendTarget;
  workspaceRoot: string;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  authProvider?: DeploymentAuthProviderConfig;
}): Promise<boolean> {
  if (opts.request.method !== "POST" || opts.url.pathname !== "/api/v1/run-actions") {
    return false;
  }
  const body = await readJsonBody<ServiceRunActionRequest>(opts.request);
  const hasServiceToken = requestHasReviewedBearerToken({
    authorizationHeader: opts.request.headers.authorization,
    serviceToken: opts.token,
    localFixture: opts.localFixture,
    env: opts.env,
  });
  if (!hasServiceToken && !opts.authProvider) {
    writeJson(opts.response, 401, { error: "unauthorized" });
    return true;
  }
  writeJson(
    opts.response,
    200,
    await handleControlPlaneRunAction(body, {
      backend: opts.backend,
      workspaceRoot: opts.workspaceRoot,
      authProvider: opts.authProvider,
      authorizationHeader: opts.request.headers.authorization,
    }),
  );
  return true;
}
