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

describe("jio mcp — http ndjson output schema registration", () => {
  test("omits outputSchema when streamingFinalAggregate=false; includes wrapper when true", async () => {
    const host = "127.0.0.1";
    const port1 = 39050 + Math.floor(Math.random() * 300);
    // First: default (flag false)
    const srv1 = await startMcpServer({ transport: "http", httpHost: host, httpPort: port1 });
    await waitForHealth(host, port1, 3000);
    const t1 = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port1}/mcp`) as any,
      {} as any,
    );
    const c1 = new Client({ name: "test", version: "0" }, {} as any);
    await c1.connect(t1 as any);
    const tools1 = await c1.listTools({});
    const nd = tools1.tools.find((x: any) => x.name === "io.example.examples.ctlndjson_ignore");
    const js = tools1.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    if (!nd || !js) {
      await c1.close().catch(() => {});
      await srv1?.close?.();
      return;
    }
    if ((nd as any).outputSchema) {
      console.error("expected NDJSON tool to omit outputSchema when aggregate=false");
      process.exit(2);
    }
    if (!(js as any).outputSchema) {
      console.error("expected JSON tool to include outputSchema");
      process.exit(2);
    }
    await c1.close().catch(() => {});
    await srv1?.close?.();

    // Second: enable aggregate
    const port2 = 39350 + Math.floor(Math.random() * 300);
    const srv2 = await startMcpServer({
      transport: "http",
      httpHost: host,
      httpPort: port2,
      streamingFinalAggregate: true,
    });
    await waitForHealth(host, port2, 3000);
    const t2 = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port2}/mcp`) as any,
      {} as any,
    );
    const c2 = new Client({ name: "test", version: "0" }, {} as any);
    await c2.connect(t2 as any);
    const tools2 = await c2.listTools({});
    const nd2 = tools2.tools.find((x: any) => x.name === "io.example.examples.ctlndjson_ignore");
    if (!nd2) {
      console.error("ctlndjson_ignore not found");
      process.exit(2);
    }
    // When aggregate=true, expect wrapper
    if (!(nd2 as any).outputSchema) {
      console.error("expected NDJSON tool to include wrapper outputSchema when aggregate=true");
      process.exit(2);
    }
    await c2.close().catch(() => {});
    await srv2?.close?.();
  });
});
