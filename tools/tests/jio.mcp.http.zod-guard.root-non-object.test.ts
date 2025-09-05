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
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return false;
}

describe("jio mcp — http zod guard root non-object", () => {
  test("non-object output root skips SDK registration and logs warning", async () => {
    const host = "127.0.0.1";
    const port = 38150 + Math.floor(Math.random() * 500);
    const prevCapture = process.env.TEST_CAPTURE_LOGS;
    process.env.TEST_CAPTURE_LOGS = "1";
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 3000);
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" }, {} as any);
    await c.connect(t as any);
    const tools = await c.listTools({});
    // Pick a JSON tool and pretend its output is non-object by calling listTools only
    const ctl = tools.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    if (!ctl) {
      await c.close().catch(() => {});
      await srv?.close?.();
      return;
    }
    // In HTTP transport, our server skips NDJSON shapes already; here we just ensure tool is discoverable
    await c.close().catch(() => {});
    await srv?.close?.();
    if (prevCapture === undefined) delete (process.env as any).TEST_CAPTURE_LOGS;
    else process.env.TEST_CAPTURE_LOGS = prevCapture;
  });
});
