#!/usr/bin/env zx-wrapper
import http from "node:http";
import { URL } from "node:url";
import type { NixosSharedHostControlPlaneBackendTarget } from "./nixos-shared-host-control-plane-backend.ts";
import type { NixosSharedHostControlPlanePaths } from "./nixos-shared-host-control-plane-contract.ts";
import {
  readControlPlaneRecord,
  handleControlPlaneRunAction,
  handleControlPlaneSubmit,
  readControlPlaneStatus,
  type ServiceRunActionRequest,
} from "./nixos-shared-host-control-plane-service-api.ts";

async function readJsonBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeJson(response: http.ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2) + "\n");
}

function checkToken(request: http.IncomingMessage, token?: string) {
  if (!token) return true;
  const header = request.headers.authorization || "";
  return header === `Bearer ${token}`;
}

export async function startNixosSharedHostControlPlaneServer(opts: {
  workspaceRoot: string;
  paths: NixosSharedHostControlPlanePaths;
  backendDatabaseUrl: string;
  host?: string;
  port?: number;
  token?: string;
}) {
  const backend = {
    recordsRoot: opts.paths.recordsRoot,
    databaseUrl: opts.backendDatabaseUrl,
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (!checkToken(request, opts.token)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/submissions") {
        writeJson(
          response,
          200,
          await handleControlPlaneSubmit(await readJsonBody(request), {
            workspaceRoot: opts.workspaceRoot,
            paths: opts.paths,
            backend,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/status") {
        const submissionId = url.searchParams.get("submissionId") || "";
        const deployRunId = url.searchParams.get("deployRunId") || "";
        const submission = await readControlPlaneStatus(backend, {
          ...(submissionId ? { submissionId } : {}),
          ...(deployRunId ? { deployRunId } : {}),
        });
        if (!submission) {
          writeJson(response, 404, { error: "submission not found" });
          return;
        }
        writeJson(response, 200, submission);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/v1/records") {
        const submissionId = url.searchParams.get("submissionId") || "";
        const deployRunId = url.searchParams.get("deployRunId") || "";
        const record = await readControlPlaneRecord(backend, {
          ...(submissionId ? { submissionId } : {}),
          ...(deployRunId ? { deployRunId } : {}),
        });
        if (!record) {
          writeJson(response, 404, { error: "record not found" });
          return;
        }
        writeJson(response, 200, record);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/v1/run-actions") {
        writeJson(
          response,
          200,
          await handleControlPlaneRunAction(await readJsonBody<ServiceRunActionRequest>(request), {
            backend,
            workspaceRoot: opts.workspaceRoot,
          }),
        );
        return;
      }
      writeJson(response, 404, { error: "not found" });
    } catch (error) {
      const statusCode = Number((error as any)?.statusCode) || 500;
      writeJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(opts.port || 0, opts.host || "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("failed to bind control-plane server");
  return {
    url: `http://${address.address}:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
