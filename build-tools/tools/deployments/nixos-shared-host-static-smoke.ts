#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import http from "node:http";
import https from "node:https";

type SmokeResponse = { status: number; body: string };
type SmokeConnectOverride = {
  protocol: "http:" | "https:";
  hostname: string;
  port: number;
  rejectUnauthorized?: boolean;
};

export type NixosSharedHostStaticSmokeResult = {
  publicUrl: string;
  healthUrl?: string;
};

const SMOKE_REQUEST_TIMEOUT_MS = 5_000;

function previewBody(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 120 ? `${singleLine.slice(0, 120)}...` : singleLine;
}

function requestForUrl(rawUrl: string, connect?: SmokeConnectOverride): Promise<SmokeResponse> {
  const url = new URL(rawUrl);
  const transportProtocol = connect?.protocol || url.protocol;
  const client = transportProtocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: transportProtocol,
        hostname: connect?.hostname || url.hostname,
        port: connect?.port || Number(url.port || (transportProtocol === "https:" ? 443 : 80)),
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
    req.setTimeout(SMOKE_REQUEST_TIMEOUT_MS, () => {
      req.destroy(
        new Error(`ETIMEDOUT smoke request to ${rawUrl} after ${SMOKE_REQUEST_TIMEOUT_MS}ms`),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function expectStatus200(
  url: string,
  connect?: SmokeConnectOverride,
): Promise<SmokeResponse> {
  const response = await requestForUrl(url, connect);
  if (response.status !== 200) {
    throw new Error(`smoke expected 200 from ${url}, got ${response.status}`);
  }
  return response;
}

export async function smokeNixosSharedHostStaticWebapp(opts: {
  hostname: string;
  indexPath: string;
  healthPath?: string;
  connectOverride?: SmokeConnectOverride;
}): Promise<NixosSharedHostStaticSmokeResult> {
  const publicRoot = `https://${opts.hostname}`;
  const publicUrl = new URL("/", publicRoot).toString();
  const expectedIndex = await fsp.readFile(opts.indexPath, "utf8");
  const publicResponse = await expectStatus200(publicUrl, opts.connectOverride);
  if (publicResponse.body !== expectedIndex) {
    throw new Error(
      `smoke content mismatch at ${publicUrl} (expected=${JSON.stringify(previewBody(expectedIndex))} actual=${JSON.stringify(previewBody(publicResponse.body))})`,
    );
  }
  if (!opts.healthPath) return { publicUrl };
  const healthUrl = new URL(opts.healthPath, publicRoot).toString();
  await expectStatus200(healthUrl, opts.connectOverride);
  return { publicUrl, healthUrl };
}
