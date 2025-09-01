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
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return false;
}

describe("jio mcp — http json (non-streaming)", () => {
  test("/mcp initialize + listTools + callTool (collected)", async () => {
    const host = "127.0.0.1";
    const port = 33001 + Math.floor(Math.random() * 1000);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    const healthy = await waitForHealth(host, port, 4000);
    if (!healthy) {
      console.error("server did not become healthy");
      try {
        await srv?.close?.();
      } catch {}
      process.exit(2);
    }
    const url = new URL(`http://${host}:${port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url as any, {} as any);
    const client = new Client({ name: "test", version: "0.0.0" });
    console.error("connecting...");
    await client.connect(transport as any);
    console.error("connected");
    const tools = await client.listTools({});
    console.error(
      "listed tools",
      Array.isArray((tools as any)?.tools) ? (tools as any).tools.length : -1,
    );
    if (!tools || !tools.tools || !Array.isArray(tools.tools)) {
      console.error("listTools failed", tools);
      try {
        await srv?.close?.();
      } catch {}
      process.exit(2);
    }
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    const result = await client.callTool({
      name: ls?.name || "io.example.examples.ls",
      arguments: {},
      _meta: { progressToken: "t1" } as any,
    } as any);
    console.error("callTool done");
    if (!result || (result.structuredContent == null && result.content == null)) {
      console.error("callTool unexpected", result);
      try {
        await srv?.close?.();
      } catch {}
      process.exit(2);
    }
    await client.close().catch(() => {});
    if (srv && srv.close) await srv.close();
  });
});

async function httpPostJson(host: string, port: number, path: string, body: any): Promise<any> {
  const raw = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        host,
        port,
        path,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
