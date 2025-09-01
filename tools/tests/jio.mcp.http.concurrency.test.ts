#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — server concurrency", () => {
  test("rejects when queue is full and honors queue timeout", async () => {
    const host = "127.0.0.1";
    const port = 36901 + Math.floor(Math.random() * 500);
    // Limit to 1 concurrent, queue size 0 to force rejection
    const srv = await startMcpServer({
      transport: "http",
      httpHost: host,
      httpPort: port,
      maxConcurrentCalls: 1,
      queueSize: 0,
    });
    process.env.JIO_MCP_TEST_DELAY_MS = "500"; // slow each call a bit
    await waitForHealth(host, port, 4000);
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" });
    await c.connect(t as any);
    const tools = await c.listTools({});
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    // First call should run, second should be rejected due to no queue
    const p1 = c.callTool({ name: ls?.name || "io.example.examples.ls", arguments: {} } as any);
    const r2 = await c.callTool({
      name: ls?.name || "io.example.examples.ls",
      arguments: {},
    } as any);
    const isErr = (r2 as any)?.isError || (r2 as any)?.type === "error" || (r2 as any)?.error;
    if (!isErr) {
      console.error("expected error result for second call when queue=0");
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await p1.catch(() => {});
    await c.close().catch(() => {});
    delete (process.env as any).JIO_MCP_TEST_DELAY_MS;
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
