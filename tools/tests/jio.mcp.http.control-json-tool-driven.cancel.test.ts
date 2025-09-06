#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { test } from "node:test";
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

test("jio mcp — http control (JSON tool-driven): cancel action returns ELICIT_CANCELLED error", async () => {
  const host = "127.0.0.1";
  const port = 37150 + Math.floor(Math.random() * 500);
  const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
  await waitForHealth(host, port, 3000);
  const t = new StreamableHTTPClientTransport(
    new URL(`http://${host}:${port}/mcp`) as any,
    {} as any,
  );
  const c = new Client({ name: "test", version: "0" }, {
    capabilities: { elicitation: {} },
  } as any);
  (c as any).setRequestHandler?.(
    (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
    async () => ({ action: "cancel" }) as any,
  );
  await c.connect(t as any);
  const tools = await c.listTools({});
  const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctljson");
  const res = await c.callTool({
    name: tool?.name || "io.example.examples.ctljson",
    arguments: {},
  } as any);
  const code = (res as any)?.code || (res as any)?.error?.code;
  if (code !== "ELICIT_CANCELLED") {
    console.error("expected ELICIT_CANCELLED", res);
    await c.close().catch(() => {});
    await srv?.close?.();
    process.exit(2);
  }
  await c.close().catch(() => {});
  await srv?.close?.();
});
