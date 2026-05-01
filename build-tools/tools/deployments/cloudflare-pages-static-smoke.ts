#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract.ts";
import {
  checkNixosSharedHostStaticWebappAvailable,
  smokeNixosSharedHostStaticWebapp,
} from "./nixos-shared-host-static-smoke.ts";

export async function smokeCloudflarePagesStaticWebapp(opts: {
  deployment: CloudflarePagesDeployment;
  indexPath: string;
  effectiveRunTarget?: CloudflarePagesDeployment["providerTarget"];
  publishedPublicUrl?: string;
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{ publicUrl: string }> {
  const target = opts.effectiveRunTarget || opts.deployment.providerTarget;
  const canonicalHostname = new URL(target.canonicalUrl).hostname;
  const publishedHostname = opts.publishedPublicUrl
    ? new URL(opts.publishedPublicUrl).hostname
    : canonicalHostname;
  const customDomain = target.customDomain?.trim();
  try {
    const exact = await smokeNixosSharedHostStaticWebapp({
      hostname: publishedHostname,
      indexPath: opts.indexPath,
      connectOverride: opts.connectOverride,
    });
    if (customDomain && canonicalHostname === customDomain && publishedHostname !== customDomain) {
      await checkNixosSharedHostStaticWebappAvailable({
        hostname: customDomain,
        connectOverride: opts.connectOverride,
      });
      return { publicUrl: target.canonicalUrl };
    }
    return exact;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (customDomain && canonicalHostname === customDomain && /got 522\b/.test(message)) {
      throw new Error(
        `${message}. Cloudflare returned 522 for custom domain ${customDomain}; the Pages project may be published while Cloudflare custom-domain routing is still activating. The deploy will keep retrying within its smoke budget, and if it still fails, check the Pages custom domain status and the CNAME for ${customDomain} -> ${target.project}.pages.dev.`,
      );
    }
    throw error;
  }
}
