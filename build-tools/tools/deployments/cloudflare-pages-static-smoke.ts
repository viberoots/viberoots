#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";

export async function smokeCloudflarePagesStaticWebapp(opts: {
  deployment: CloudflarePagesDeployment;
  indexPath: string;
  effectiveRunTarget?: CloudflarePagesDeployment["providerTarget"];
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ publicUrl: string }> {
  return await smokeNixosSharedHostStaticWebapp({
    hostname: new URL((opts.effectiveRunTarget || opts.deployment.providerTarget).canonicalUrl)
      .hostname,
    indexPath: opts.indexPath,
    connectOverride: opts.connectOverride,
  });
}
