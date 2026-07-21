#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { checkControlPlaneReadiness } from "./control-plane-process-health";
import { assertReviewedServiceTokenConfigured } from "./nixos-shared-host-control-plane-service-auth";
import { writeJson } from "./control-plane-http";
import { readControlPlaneImageMetadata } from "./control-plane-image-metadata";
import { handleNixosSharedHostControlPlaneRequest } from "./nixos-shared-host-control-plane-server-routes";
import type { NixosSharedHostControlPlaneServerOptions } from "./nixos-shared-host-control-plane-server-options";

export async function startNixosSharedHostControlPlaneServer(
  opts: NixosSharedHostControlPlaneServerOptions,
) {
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
          runtimeConfig: { profileIdentity: opts.instanceId || "unknown" },
        });
        writeJson(response, readiness.ok ? 200 : 503, readiness);
        return;
      }
      await handleNixosSharedHostControlPlaneRequest({ opts, backend, request, response });
    } catch (error) {
      const statusCode = Number((error as any)?.statusCode) || 500;
      writeJson(response, statusCode, {
        error: redactDeploymentAuthText(error instanceof Error ? error.message : String(error)),
      });
    }
  });
  // prettier-ignore
  await new Promise<void>((resolve) => server.listen(opts.port || 0, opts.host || "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("failed to bind control-plane server");
  return {
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      // prettier-ignore
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
