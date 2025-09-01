#!/usr/bin/env zx-wrapper
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

async function req(
  opts: http.RequestOptions & { body?: any },
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    r.on("error", reject);
    if (opts.body) r.end(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    else r.end();
  });
}

describe("jio mcp — http headers", () => {
  test("POST /mcp requires Accept with json+event-stream and application/json content-type", async () => {
    const host = "127.0.0.1";
    const port = 35001 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    // Missing Accept
    {
      const { status } = await req({
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: { "content-type": "application/json" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "t", version: "0" }, capabilities: {} },
        },
      });
      if (status !== 406) {
        console.error("expected 406 for missing Accept, got", status);
        await srv?.close?.();
        process.exit(2);
      }
    }
    // Missing content-type
    {
      const { status } = await req({
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: { accept: "application/json, text/event-stream" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "t", version: "0" }, capabilities: {} },
        },
      });
      if (status !== 415) {
        console.error("expected 415 for missing content-type, got", status);
        await srv?.close?.();
        process.exit(2);
      }
    }
    await srv?.close?.();
  });

  test("Host allowlist blocks unexpected host", async () => {
    const host = "127.0.0.1";
    const port = 35051 + Math.floor(Math.random() * 500);
    process.env.JIO_HTTP_ALLOWED_HOSTS = `${host}:${port}`; // only allow explicit host:port
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    // Use wrong Host header
    const { status } = await req({
      method: "POST",
      host,
      port,
      path: "/mcp",
      headers: {
        host: `evil.local:${port}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "t", version: "0" }, capabilities: {} },
      },
    });
    delete process.env.JIO_HTTP_ALLOWED_HOSTS;
    if (status !== 403) {
      console.error("expected 403 for invalid host, got", status);
      await srv?.close?.();
      process.exit(2);
    }
    await srv?.close?.();
  });
});
