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

describe("jio mcp — http queue timeout", () => {
  test("third request times out with small queue timeout", async () => {
    const host = "127.0.0.1";
    const port = 37100 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({
      transport: "http",
      httpHost: host,
      httpPort: port,
      maxConcurrentCalls: 1,
      queueSize: 2,
      queueTimeoutMs: 150,
    });
    process.env.JIO_MCP_TEST_DELAY_MS = "500";
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
    const call = () => c.callTool({ name: ls.name, arguments: {} } as any);
    const p1 = call();
    const p2 = call();
    // Delay a bit so p2 is queued, then start p3 which should time out while waiting in queue
    await new Promise((r) => setTimeout(r, 50));
    const p3 = call().then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, e }),
    );
    const r3 = await p3;
    if (r3.ok && !(r3 as any).v?.error) {
      console.error("expected timeout/error for third call", r3);
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await Promise.allSettled([p1, p2]);
    await c.close().catch(() => {});
    delete (process.env as any).JIO_MCP_TEST_DELAY_MS;
    await srv?.close?.();
  });
});
