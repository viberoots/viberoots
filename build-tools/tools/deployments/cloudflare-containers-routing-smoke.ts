#!/usr/bin/env zx-wrapper
import http from "node:http";
import https from "node:https";
import type { CloudflareContainersDeployment } from "./contract";

export type CloudflareContainersSmokeConnectOverride = {
  hostname: string;
  port: number;
  protocol?: "http:" | "https:";
};

export type CloudflareContainersSmokeResult = {
  smokeUrl?: string;
  smokeOutcome: "passed" | "omitted_by_exception";
};

function routePath(deployment: CloudflareContainersDeployment): string {
  const healthPath = deployment.providerTarget.healthPath || "/";
  return healthPath.startsWith("/") ? healthPath : `/${healthPath}`;
}

function smokeUrlFor(
  deployment: CloudflareContainersDeployment,
  override: CloudflareContainersSmokeConnectOverride,
): string {
  return `${override.protocol || "http:"}//${override.hostname}:${override.port}${routePath(
    deployment,
  )}`;
}

async function requestSmokeUrl(url: string, headers: Record<string, string>): Promise<number> {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  return await new Promise<number>((resolve, reject) => {
    const request = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode || 0));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

export async function smokeCloudflareContainersRouting(opts: {
  deployment: CloudflareContainersDeployment;
  connectOverride?: CloudflareContainersSmokeConnectOverride;
}): Promise<CloudflareContainersSmokeResult> {
  if (opts.deployment.providerTarget.ingressMode === "none") {
    return { smokeOutcome: "omitted_by_exception" };
  }
  if (!opts.connectOverride) {
    return {
      smokeUrl: opts.deployment.providerTarget.canonicalUrl,
      smokeOutcome:
        opts.deployment.providerTarget.ingressMode === "public" ? "passed" : "omitted_by_exception",
    };
  }
  const publicHost =
    opts.deployment.providerTarget.domain || `${opts.deployment.providerTarget.worker}.workers.dev`;
  const privateHeaders =
    opts.deployment.providerTarget.ingressMode === "private"
      ? {
          "x-cloudflare-containers-private-route":
            opts.deployment.providerTarget.providerTargetIdentity,
        }
      : {};
  const smokeUrl = smokeUrlFor(opts.deployment, opts.connectOverride);
  const status = await requestSmokeUrl(smokeUrl, {
    Host: opts.deployment.providerTarget.ingressMode === "public" ? publicHost : "worker.internal",
    ...privateHeaders,
  });
  if (status < 200 || status >= 300) {
    throw new Error(`cloudflare-containers routing smoke expected 2xx, got ${status}`);
  }
  return { smokeUrl, smokeOutcome: "passed" };
}
