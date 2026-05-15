#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import type { ControlPlaneArtifactStore } from "./control-plane-artifact-store-types";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend";
import { handleControlPlaneMcpRoute } from "./deployment-control-plane-mcp";
import { handleControlPlaneWebRoute } from "./deployment-control-plane-web-routes";

export async function handleControlPlanePresentationRoutes(opts: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  url: URL;
  backend: NixosSharedHostControlPlaneBackendTarget;
  objectStore?: ControlPlaneArtifactStore;
  token?: string;
  localFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  instanceId?: string;
  webUi?: { enabled: boolean; basePath: string };
  mcp?: { enabled: boolean; basePath: string };
}) {
  const presentation = {
    backend: opts.backend,
    objectStore: opts.objectStore,
    token: opts.token,
    localFixture: opts.localFixture,
    env: opts.env,
    instanceId: opts.instanceId,
  };
  return (
    (await handleControlPlaneMcpRoute({
      request: opts.request,
      response: opts.response,
      url: opts.url,
      mcp: {
        ...presentation,
        enabled: opts.mcp?.enabled ?? true,
        basePath: opts.mcp?.basePath ?? "/mcp",
      },
    })) ||
    (await handleControlPlaneWebRoute({
      request: opts.request,
      response: opts.response,
      url: opts.url,
      web: {
        ...presentation,
        enabled: opts.webUi?.enabled ?? true,
        basePath: opts.webUi?.basePath ?? "/",
      },
    }))
  );
}
