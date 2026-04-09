#!/usr/bin/env zx-wrapper
import type { S3StaticDeployment } from "./contract.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";

export async function smokeS3StaticWebapp(opts: {
  deployment: S3StaticDeployment;
  indexPath: string;
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ publicUrl: string }> {
  return await smokeNixosSharedHostStaticWebapp({
    hostname: new URL(opts.deployment.providerTarget.canonicalUrl).hostname,
    indexPath: opts.indexPath,
    connectOverride: opts.connectOverride,
  });
}
