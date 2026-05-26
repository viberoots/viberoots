#!/usr/bin/env zx-wrapper
import http from "node:http";
import type { FakeInfisicalSecret } from "./infisical.test-server";

export async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function sameSecret(
  entry: FakeInfisicalSecret,
  params: URLSearchParams,
  secretName: string,
  version = "",
) {
  return (
    entry.projectId === params.get("projectId") &&
    entry.environment === params.get("environment") &&
    entry.secretPath === params.get("secretPath") &&
    entry.secretName === secretName &&
    (!version || entry.version === version)
  );
}

export function validateSecretWriteBody(body: Record<string, unknown>, params: URLSearchParams) {
  for (const key of ["projectId", "environment", "secretPath", "type"]) {
    if (body[key] !== params.get(key)) {
      return { error: "ValidationFailure", message: `${key} must be present in write body` };
    }
  }
  return undefined;
}
