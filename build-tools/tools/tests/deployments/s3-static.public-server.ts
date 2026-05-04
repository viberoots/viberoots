#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { S3StaticDeployment } from "../../deployments/contract";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server";

export async function startS3StaticPublicServer(opts: {
  deployment: S3StaticDeployment;
  publishRoot: string;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  return await startStaticWebappHttpsServer({
    hostname: new URL(opts.deployment.providerTarget.canonicalUrl).hostname,
    root: path.join(path.resolve(opts.publishRoot), opts.deployment.providerTarget.bucket),
    tlsRoot: opts.tlsRoot || opts.publishRoot,
  });
}
