#!/usr/bin/env zx-wrapper
import http from "node:http";
import https from "node:https";
import type { VercelDeployment } from "./contract";

export type VercelSmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

function requestText(url: URL, override?: VercelSmokeConnectOverride): Promise<string> {
  const effective = new URL(url.toString());
  if (override) {
    effective.protocol = override.protocol;
    effective.hostname = override.hostname;
    effective.port = String(override.port);
  }
  const transport = effective.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      effective,
      {
        headers: { host: url.host },
        rejectUnauthorized: override?.rejectUnauthorized,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 400) {
            reject(new Error(`vercel smoke expected 2xx from ${url}, got ${res.statusCode}`));
            return;
          }
          resolve(body);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function requireText(body: string, needle: string, label: string) {
  if (!body.includes(needle)) throw new Error(`vercel smoke missing ${label}: ${needle}`);
}

export async function smokeVercelConsole(opts: {
  deployment: VercelDeployment;
  publicUrl: string;
  expectedAppShell?: string;
  expectedAuthRoute?: string;
  expectedConsoleToWebBaseUrl?: string;
  connectOverride?: VercelSmokeConnectOverride;
}): Promise<{ publicUrl: string }> {
  const publicUrl = new URL(opts.publicUrl || opts.deployment.providerTarget.canonicalUrl);
  const body = await requestText(publicUrl, opts.connectOverride);
  requireText(body, opts.expectedAppShell || "<html", "app shell");
  if (opts.expectedConsoleToWebBaseUrl) {
    requireText(body, opts.expectedConsoleToWebBaseUrl, "console-to-web base URL");
  }
  const authRoute = opts.expectedAuthRoute || "/login";
  await requestText(new URL(authRoute, publicUrl), opts.connectOverride);
  return { publicUrl: publicUrl.toString() };
}
