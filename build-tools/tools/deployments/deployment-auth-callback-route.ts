#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import { handleDeploymentAuthCallback } from "./deployment-auth-session-service";
import { writeJson } from "./control-plane-http";

export async function handleDeploymentAuthCallbackRoute(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  callbackPath: string;
  recordsRoot: string;
  backend: { recordsRoot: string; databaseUrl: string };
}): Promise<boolean> {
  if (opts.request.method !== "GET" || opts.url.pathname !== opts.callbackPath) return false;
  const code = opts.url.searchParams.get("code") || "";
  const state = opts.url.searchParams.get("state") || "";
  if (!code || !state) {
    writeJson(opts.response, 400, { error: "OIDC callback missing code or state" });
    return true;
  }
  writeJson(
    opts.response,
    200,
    await handleDeploymentAuthCallback({
      recordsRoot: opts.recordsRoot,
      backend: opts.backend,
      code,
      state,
    }),
  );
  return true;
}
