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

describe("jio mcp — http control ignore via spec flag", () => {
  test(
    "spec.command.ignoreControlMessages passes control lines as output",
    { timeout: 15000 },
    async () => {
      const host = "127.0.0.1";
      const port = 37050 + Math.floor(Math.random() * 500);
      const srv = await startMcpServer({
        transport: "http",
        httpHost: host,
        httpPort: port,
        streamingFinalAggregate: true,
      });
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
      await c.connect(t as any);
      const tools = await c.listTools({});
      const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctlndjson_ignore");
      const res = await c.callTool({ name: tool.name, arguments: {} } as any);
      const sc = (res as any)?.structuredContent;
      const items = Array.isArray(sc?.items) ? sc.items : Array.isArray(sc) ? sc : [];
      const hasCtl = items.some((o: any) => o && o["$jio.ctl"] === true);
      if (!hasCtl) {
        console.error("expected raw control object in output array", res);
        await c.close().catch(() => {});
        await (t as any).close?.().catch(() => {});
        await srv?.close?.();
        process.exit(2);
      }
      await c.close().catch(() => {});
      try {
        await (t as any).close?.();
      } catch {}
      await srv?.close?.();
    },
  );
});
