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
      await new Promise((r) => setTimeout(r, 200));
      // Preflight GET to create session and get cookie
      const pre = await new Promise<{ status: number; headers: any }>((resolve) => {
        const req = http.request(
          { method: "GET", host, port, path: "/mcp", headers: { accept: "text/event-stream" } },
          (res) => {
            const headers = res.headers;
            res.resume();
            resolve({ status: res.statusCode || 0, headers });
            res.destroy();
          },
        );
        req.on("error", () => resolve({ status: 0, headers: {} }));
        req.end();
      });
      const cookie = pre.headers["set-cookie"]?.[0] || "";
      const { status, headers } = await postInit(host, port);
      if (status !== 200) {
        console.error("init failed", status);
        await srv?.close?.();
        process.exit(2);
      }
      const cookie2 = headers["set-cookie"]?.[0] || cookie || "";
      // Extract session id from response headers or cookie (case-insensitive)
      let sessionId =
        (pre.headers as any)["mcp-session-id"] || (headers as any)["mcp-session-id"] || "";
      if (Array.isArray(sessionId)) sessionId = sessionId[0] || "";
      if (!sessionId && cookie2) {
        const m = /mcp-session-id=([^;]+)/i.exec(cookie2);
        if (m && m[1]) sessionId = m[1];
      }
      const {
        status: status2,
        headers: headers2,
        body: body2,
      } = await postListTools(host, port, cookie2, sessionId);
      if (status2 !== 200) {
        console.error("listTools failed", status2, body2);
        await srv?.close?.();
        process.exit(2);
      }
      const ct = headers2["content-type"] || headers["content-type"];
      // Expect SSE when client accepts SSE
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
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
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

async function postListTools(host: string, port: number, cookie?: string, sessionId?: string) {
  return await new Promise<{ status: number; headers: any; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(cookie ? { cookie } : {}),
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  });
}
