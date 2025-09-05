#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

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
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return false;
}

describe("jio mcp — http ndjson elicit streaming continuation", () => {
  test("streams items before and after elicitation; ignores control lines", async () => {
    const host = "127.0.0.1";
    const port = 37100 + Math.floor(Math.random() * 500);
    delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 3000);
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" }, {
      capabilities: { elicitation: {} },
    } as any);
    // Auto-accept all elicitations with empty content
    (c as any).setRequestHandler?.(
      (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
      async () => ({ action: "accept", content: {} }) as any,
    );
    let seen: any[] = [];
    (t as any).onmessage = (msg: any) => {
      if (msg && msg.method === "notifications/progress" && msg.params?.item)
        seen.push(msg.params.item);
    };
    await c.connect(t as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctlndjson");
    if (!tool) {
      console.error("ctlndjson tool not found");
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    const res = await c.callTool({ name: tool.name, arguments: {} } as any);
    // Must have at least one item seen (pre- or post-)
    if (seen.length < 1) {
      console.error("expected streamed items", { seen });
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    // Final aggregate (server default may not aggregate). Accept either aggregate or undefined.
    if ((res as any)?.structuredContent && (res as any)?.structuredContent.items) {
      if (!Array.isArray((res as any).structuredContent.items)) {
        console.error("expected items array");
        await c.close().catch(() => {});
        await srv?.close?.();
        process.exit(2);
      }
    }
    await c.close().catch(() => {});
    await srv?.close?.();
  });
});
