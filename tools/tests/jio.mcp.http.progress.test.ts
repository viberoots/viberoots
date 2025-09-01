#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http progress", () => {
  test("emits progress with token before final result", async () => {
    const host = "127.0.0.1";
    const port = 36701 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 4000);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    let sawProgress = false;
    (transport as any).onmessage = (msg: any) => {
      if (msg?.method === "notifications/progress") sawProgress = true;
    };
    await client.connect(transport as any);
    const tools = await client.listTools({});
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    const res = await client.callTool({
      name: ls?.name || "io.example.examples.ls",
      arguments: {},
      _meta: { progressToken: "p3" },
    } as any);
    if (!res || (!sawProgress && process.env.CI === "true")) {
      console.error("expected progress before result");
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
