#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type {
  ControlPlaneArtifactStore,
  ControlPlaneArtifactStoreConfig,
} from "./control-plane-artifact-store-types";

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function physicalKey(config: ControlPlaneArtifactStoreConfig, key: string): string {
  const prefix = (config.keyPrefix || "").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

function objectUrl(config: ControlPlaneArtifactStoreConfig, key: string): URL {
  const endpoint = new URL(config.endpoint.replace("{bucket}", encodeURIComponent(config.bucket)));
  const encodedKey = encodeKey(physicalKey(config, key));
  if (config.endpoint.includes("{bucket}")) {
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encodedKey}`;
    return endpoint;
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/${encodeURIComponent(
    config.bucket,
  )}/${encodedKey}`;
  return endpoint;
}

function signingHeaders(opts: {
  method: string;
  url: URL;
  config: ControlPlaneArtifactStoreConfig;
  body?: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const bodyHash = sha256Hex(opts.body || "");
  const headers: Record<string, string> = {
    host: opts.url.host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date": amzDate,
    ...(opts.contentType ? { "content-type": opts.contentType } : {}),
  };
  for (const [key, value] of Object.entries(opts.metadata || {})) {
    headers[`x-amz-meta-${key.toLowerCase()}`] = value;
  }
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${headers[key]}\n`).join("");
  const canonicalRequest = [
    opts.method,
    opts.url.pathname,
    opts.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaderNames.join(";"),
    bodyHash,
  ].join("\n");
  const scope = `${date}/${opts.config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${opts.config.secretAccessKey}`, date), opts.config.region), "s3"),
    "aws4_request",
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(
      ";",
    )}, Signature=${signature}`,
  };
}

async function assertOk(response: Response, action: string, key: string): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text().catch(() => "");
  throw new Error(`${action} artifact object failed for ${key}: ${response.status} ${text}`);
}

function responseMetadata(response: Response) {
  const metadata: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.startsWith("x-amz-meta-")) metadata[key.slice("x-amz-meta-".length)] = value;
  });
  return {
    contentType: response.headers.get("content-type") || undefined,
    metadata,
  };
}

export function createS3CompatibleArtifactStore(
  config: ControlPlaneArtifactStoreConfig,
): ControlPlaneArtifactStore {
  return {
    kind: "s3-compatible",
    bucket: config.bucket,
    putObject: async (input) => {
      const url = objectUrl(config, input.key);
      const headers = signingHeaders({
        method: "PUT",
        url,
        config,
        body: input.body,
        contentType: input.contentType,
        metadata: input.metadata,
      });
      await assertOk(
        await fetch(url, { method: "PUT", headers, body: input.body }),
        "put",
        input.key,
      );
    },
    getObject: async (input) => {
      const url = objectUrl(config, input.key);
      const headers = signingHeaders({ method: "GET", url, config });
      const response = await assertOk(
        await fetch(url, { method: "GET", headers }),
        "get",
        input.key,
      );
      return Buffer.from(await response.arrayBuffer());
    },
    getObjectMetadata: async (input) => {
      const url = objectUrl(config, input.key);
      const headers = signingHeaders({ method: "HEAD", url, config });
      const response = await assertOk(
        await fetch(url, { method: "HEAD", headers }),
        "head",
        input.key,
      );
      return responseMetadata(response);
    },
  };
}
