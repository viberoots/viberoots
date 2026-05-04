#!/usr/bin/env zx-wrapper
import path from "node:path";
import type {
  CloudflarePagesDeployment,
  CloudflarePagesProviderTarget,
} from "../../deployments/contract";
import { cloudflarePagesPublishedPath } from "../../deployments/cloudflare-pages-preview";
import { startStaticWebappHttpsServer } from "./static-webapp.https-server";

export async function startCloudflarePagesPublicServer(opts: {
  deployment: CloudflarePagesDeployment;
  publishRoot: string;
  effectiveRunTarget?: CloudflarePagesProviderTarget;
  tlsRoot?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const effectiveRunTarget = opts.effectiveRunTarget || opts.deployment.providerTarget;
  return await startStaticWebappHttpsServer({
    hostname: new URL(effectiveRunTarget.canonicalUrl).hostname,
    root: cloudflarePagesPublishedPath(path.resolve(opts.publishRoot), effectiveRunTarget),
    tlsRoot: opts.tlsRoot || opts.publishRoot,
  });
}
