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

describe("jio mcp — http ndjson streaming", () => {
  test("emits item notifications before final result for ndjson tools", async () => {
    const host = "127.0.0.1";
    const port = 37400 + Math.floor(Math.random() * 500);
    // Ensure SSE mode, not JSON fallback
    const prevJson = process.env.JIO_MCP_HTTP_JSON_RESPONSE;
    delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    const ok = await waitForHealth(host, port, 3000);
    if (!ok) {
      console.error("server not healthy");
      await srv?.close?.();
      process.exit(2);
    }
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" });
    let itemCount = 0;
    (t as any).onmessage = (msg: any) => {
      if (msg && msg.method === "notifications/item") itemCount++;
    };
    await c.connect(t as any);
    const tools = await c.listTools({});
    const ls = tools.tools.find((x: any) => x.name === "io.example.examples.ls");
    if (!ls) {
      console.error("ls tool not found");
      await c.close().catch(() => {});
      await srv?.close?.();
      if (prevJson === undefined) delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
      else process.env.JIO_MCP_HTTP_JSON_RESPONSE = prevJson;
      process.exit(2);
    }
    const res = await c.callTool({ name: ls.name, arguments: {} } as any).catch((e) => e);
    const sc = (res as any)?.structuredContent;
    // We expect at least one notification; final payload may be empty in streaming mode
    if (itemCount <= 0 || (!sc && !(res as any)?.content && !(res as any)?.control)) {
      console.error("expected item notifications and some final result", {
        itemCount,
        hasContent: !!sc,
      });
      await c.close().catch(() => {});
      await srv?.close?.();
      if (prevJson === undefined) delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
      else process.env.JIO_MCP_HTTP_JSON_RESPONSE = prevJson;
      process.exit(2);
    }
    await c.close().catch(() => {});
    try {
      await (t as any).close?.();
    } catch {}
    await srv?.close?.();
    if (prevJson === undefined) delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE;
    else process.env.JIO_MCP_HTTP_JSON_RESPONSE = prevJson;
  });
});
