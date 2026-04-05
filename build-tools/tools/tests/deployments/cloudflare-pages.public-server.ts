#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { CloudflarePagesDeployment } from "../../deployments/contract.ts";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server.ts";

export async function startCloudflarePagesPublicServer(opts: {
  deployment: CloudflarePagesDeployment;
  publishRoot: string;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  return await startStaticWebappHttpsServer({
    hostname: new URL(opts.deployment.providerTarget.canonicalUrl).hostname,
    root: path.join(path.resolve(opts.publishRoot), opts.deployment.providerTarget.project),
    tlsRoot: opts.tlsRoot || opts.publishRoot,
  });
}
