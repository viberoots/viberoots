#!/usr/bin/env zx-wrapper
import http from "node:http";

const MAX_REQUEST_BODY_BYTES = 60 * 1024 * 1024;

export async function readRawBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BODY_BYTES) throw new Error("request body exceeds size limit");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  return JSON.parse((await readRawBody(request)).toString("utf8")) as T;
}

export function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown,
  headers: http.OutgoingHttpHeaders = {},
) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(value, null, 2) + "\n");
}
