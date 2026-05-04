#!/usr/bin/env zx-wrapper
import http from "node:http";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { KubernetesDeployment } from "../../deployments/contract";

export async function startKubernetesPublicServer(opts: {
  deployment: KubernetesDeployment;
  publishRoot: string;
}): Promise<{ port: number; close(): Promise<void> }> {
  const targetDir = path.join(
    path.resolve(opts.publishRoot),
    opts.deployment.providerTarget.namespace,
    opts.deployment.providerTarget.release,
  );
  const server = http.createServer(async (_request, response) => {
    try {
      const body = await fsp.readFile(path.join(targetDir, "release-state.json"), "utf8");
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(body);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("release state unavailable");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind kubernetes server");
  return {
    port: address.port,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
