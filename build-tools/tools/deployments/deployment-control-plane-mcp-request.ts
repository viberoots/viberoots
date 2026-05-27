#!/usr/bin/env zx-wrapper
import http from "node:http";

const MAX_MCP_BODY_BYTES = 1024 * 1024;

export type McpJsonRequestResult =
  | { ok: true; request: Record<string, any> }
  | { ok: false; error: string };

export async function readMcpJsonRequest(
  request: http.IncomingMessage,
): Promise<McpJsonRequestResult> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      length += buffer.length;
      if (length > MAX_MCP_BODY_BYTES) throw new Error("MCP request body too large");
      chunks.push(buffer);
    }
    return {
      ok: true,
      request: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, any>,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
