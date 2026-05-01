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
  const target = opts.effectiveRunTarget || opts.deployment.providerTarget;
  const hostname = new URL(target.canonicalUrl).hostname;
  try {
    return await smokeNixosSharedHostStaticWebapp({
      hostname,
      indexPath: opts.indexPath,
      connectOverride: opts.connectOverride,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const customDomain = target.customDomain?.trim();
    if (customDomain && hostname === customDomain && /got 522\b/.test(message)) {
      throw new Error(
        `${message}. Cloudflare returned 522 for custom domain ${customDomain}; the Pages project may be published while Cloudflare custom-domain routing is still activating. The deploy will keep retrying within its smoke budget, and if it still fails, check the Pages custom domain status and the CNAME for ${customDomain} -> ${target.project}.pages.dev.`,
      );
    }
    throw error;
  }
}
