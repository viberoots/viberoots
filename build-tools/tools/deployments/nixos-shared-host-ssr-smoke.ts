#!/usr/bin/env zx-wrapper
import http from "node:http";
import https from "node:https";

type SmokeResponse = { status: number; body: string };
type SmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

export type NixosSharedHostSsrSmokeResult = {
  publicUrl: string;
  healthUrl?: string;
};

function requestForUrl(rawUrl: string, connect?: SmokeConnectOverride): Promise<SmokeResponse> {
  const url = new URL(rawUrl);
  const protocol = connect?.protocol || url.protocol;
  const client = protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol,
        hostname: connect?.hostname || url.hostname,
        port: connect?.port || Number(url.port || (protocol === "https:" ? 443 : 80)),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { host: url.host },
        servername: url.hostname,
        rejectUnauthorized: connect?.rejectUnauthorized ?? true,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function expectStatus200(url: string, connect?: SmokeConnectOverride): Promise<void> {
  const response = await requestForUrl(url, connect);
  if (response.status !== 200) {
    throw new Error(`smoke expected 200 from ${url}, got ${response.status}`);
  }
}

export async function smokeNixosSharedHostSsrWebapp(opts: {
  hostname: string;
  healthPath?: string;
  connectOverride?: SmokeConnectOverride;
}): Promise<NixosSharedHostSsrSmokeResult> {
  const publicRoot = `https://${opts.hostname}`;
  const publicUrl = new URL("/", publicRoot).toString();
  await expectStatus200(publicUrl, opts.connectOverride);
  if (!opts.healthPath) return { publicUrl };
  const healthUrl = new URL(opts.healthPath, publicRoot).toString();
  await expectStatus200(healthUrl, opts.connectOverride);
  return { publicUrl, healthUrl };
}
