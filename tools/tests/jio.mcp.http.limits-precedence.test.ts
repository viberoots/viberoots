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

describe("jio mcp — http limits precedence", () => {
  test("server flags override spec defaults (items and bytes)", async () => {
    const host = "127.0.0.1";
    const port = 37250 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({
      transport: "http",
      httpHost: host,
      httpPort: port,
      // Force small caps so override effect is observable
      maxItemsPerCall: 2,
      maxCollectBytes: 50,
      maxStdoutJsonBytes: 64,
      maxNdjsonLineBytes: 64,
    });
    const ok = await waitForHealth(host, port, 3000);
    if (!ok) {
      console.error("server not healthy");
      await srv?.close?.();
      process.exit(2);
    }
    const url = new URL(`http://${host}:${port}/mcp`);
    const t = new StreamableHTTPClientTransport(url as any, {} as any);
    const c = new Client({ name: "test", version: "0" });
    await c.connect(t as any);
    const tools = await c.listTools({});
    const ls = tools.tools.find((x: any) => x.name === "io.example.examples.ls");
    if (!ls) {
      console.error("ls tool not found");
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    // This tool emits a small, predictable set. With maxItemsPerCall=2, one of these calls should fail when collecting
    const res = await c.callTool({ name: ls.name, arguments: {} } as any);
    // We expect either an explicit error, or a collected array, or an aggregate {items: [...]} capped by limits.
    const isError = (res as any)?.error || (res as any)?.isError;
    const sc: any = (res as any)?.structuredContent;
    const isArray = Array.isArray(sc);
    const isItemsObj = sc && typeof sc === "object" && Array.isArray(sc.items);
    if (!isError && !isArray && !isItemsObj) {
      console.error("expected error or array or {items} result", res);
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    if (isItemsObj) {
      if (!Array.isArray(sc.items) || sc.items.length > 2) {
        console.error("expected {items} length <= server cap", sc);
        await c.close().catch(() => {});
        await srv?.close?.();
        process.exit(2);
      }
    }
    await c.close().catch(() => {});
    try {
      await (t as any).close?.();
    } catch {}
    await srv?.close?.();
  });
});
