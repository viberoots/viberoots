#!/usr/bin/env zx-wrapper
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http SSE POST behavior", () => {
  test("POST /mcp returns SSE when JSON fallback not forced", async () => {
    const host = "127.0.0.1";
    const port = 36801 + Math.floor(Math.random() * 500);
    const prev = process.env.JIO_MCP_HTTP_JSON_RESPONSE;
    try {
      delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
      const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
      const { status, headers } = await postInit(host, port);
      if (status !== 200) {
        console.error("init failed", status);
        await srv?.close?.();
        process.exit(2);
      }
      const { status: status2, headers: headers2 } = await postListTools(host, port);
      if (status2 !== 200) {
        console.error("listTools failed", status2);
        await srv?.close?.();
        process.exit(2);
      }
      const ct = headers2["content-type"] || headers["content-type"];
      // We expect SSE by default (text/event-stream)
      if (!ct || !String(ct).includes("text/event-stream")) {
        console.error("expected text/event-stream, got", ct);
        await srv?.close?.();
        process.exit(2);
      }
      await srv?.close?.();
    } finally {
      if (prev === undefined) delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
      else process.env.JIO_MCP_HTTP_JSON_RESPONSE = prev;
    }
  });
});

async function postInit(host: string, port: number) {
  return await new Promise<{ status: number; headers: any }>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, headers: res.headers });
      },
    );
    req.on("error", reject);
    req.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "t", version: "0" },
          capabilities: {},
          protocolVersion: "2025-06-18",
        },
      }),
    );
  });
}

async function postListTools(host: string, port: number) {
  return await new Promise<{ status: number; headers: any }>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, headers: res.headers });
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  });
}
