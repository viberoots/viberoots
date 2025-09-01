#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http cancel", () => {
  test("cancel a slow call", async () => {
    const host = "127.0.0.1";
    const port = 36501 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 4000);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    const seen: any[] = [];
    (transport as any).onmessage = (msg: any) => {
      seen.push(msg);
    };
    await client.connect(transport as any);
    const tools = await client.listTools({});
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    // fire request
    const req = client.callTool({
      name: ls?.name || "io.example.examples.ls",
      arguments: {},
      _meta: { progressToken: "p2" },
    } as any);
    // send cancellation via POST (mimic notification)
    // Use the explicit id from our pending request (the SDK assigns monotonically)
    const cancelId = 3;
    await postJson(host, port, {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: cancelId },
    });
    let failed = false;
    try {
      await req;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected cancellation error");
      await client.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    // Assert no progress after cancellation event observed
    const idxCancel = seen.findIndex((m) => m?.method === "notifications/cancelled");
    const idxAfter = seen.findIndex(
      (m, i) => i > idxCancel && m?.method === "notifications/progress",
    );
    if (idxCancel >= 0 && idxAfter >= 0) {
      console.error("saw progress after cancellation, which should not happen");
      await client.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await client.close().catch(() => {});
    await srv?.close?.();
  });
});

async function waitForHealth(host: string, port: number, ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({ method: "GET", host, port, path: "/health" }, (res) => {
          res.resume();
          res.on("end", () => resolve());
        });
        req.on("error", reject);
        req.end();
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

async function postJson(
  host: string,
  port: number,
  body: any,
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
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
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
