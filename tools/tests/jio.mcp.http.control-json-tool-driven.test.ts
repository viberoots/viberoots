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

describe("jio mcp — http control (JSON tool-driven)", () => {
  test("final JSON with $jio.ctl.elicit returns control response", async () => {
    const host = "127.0.0.1";
    const port = 37150 + Math.floor(Math.random() * 500);
    const prevAuto = process.env.JIO_MCP_TEST_AUTO_ELICIT;
    process.env.JIO_MCP_TEST_AUTO_ELICIT = "1";
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 3000);
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" }, {
      capabilities: { elicitation: {} },
    } as any);
    // Accept all elicitations with empty content
    (c as any).setRequestHandler?.(
      (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
      async () => {
        return { action: "accept", content: {} } as any;
      },
    );
    await c.connect(t as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    if (!tool) {
      console.error("ctljson tool not found");
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    const res = await c.callTool({ name: tool.name, arguments: {} } as any);
    if ((res as any)?.isError || (res as any)?.error) {
      console.error("expected success result after elicitation", res);
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await c.close().catch(() => {});
    await srv?.close?.();
    if (prevAuto === undefined) delete (process.env as any).JIO_MCP_TEST_AUTO_ELICIT;
    else process.env.JIO_MCP_TEST_AUTO_ELICIT = prevAuto;
  });

  test("decline action returns ELICIT_DECLINED error", async () => {
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
      async () => ({ action: "decline" }) as any,
    );
    await c.connect(t as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    const res = await c.callTool({
      name: tool?.name || "io.example.examples.ctljson",
      arguments: {},
    } as any);
    const code = (res as any)?.code || (res as any)?.error?.code;
    if (code !== "ELICIT_DECLINED") {
      console.error("expected ELICIT_DECLINED", res);
      await c.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await c.close().catch(() => {});
    await srv?.close?.();
  });

  test("cancel action returns ELICIT_CANCELLED error", async () => {
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

  test("elicitation timeout returns ELICIT_TIMEOUT error", async () => {
    const host = "127.0.0.1";
    const port = 37150 + Math.floor(Math.random() * 500);
    const prevCapture = process.env.TEST_CAPTURE_LOGS;
    process.env.TEST_CAPTURE_LOGS = "1";
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 3000);
    const t = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const c = new Client({ name: "test", version: "0" }, {
      capabilities: { elicitation: {} },
    } as any);
    // Register a handler that never resolves to force server-side timeout
    (c as any).setRequestHandler?.(
      (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
      async () => await new Promise(() => {}),
    );
    // Simulate a short timeout via env
    const prev = process.env.JIO_MCP_ELICITATION_TIMEOUT_MS;
    process.env.JIO_MCP_ELICITATION_TIMEOUT_MS = "200";
    await c.connect(t as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    const res = await c.callTool({
      name: tool?.name || "io.example.examples.ctljson",
      arguments: {},
    } as any);
    const code = (res as any)?.code || (res as any)?.error?.code;
    if (code !== "ELICIT_TIMEOUT") {
      console.error("expected ELICIT_TIMEOUT", res);
      await c.close().catch(() => {});
      await srv?.close?.();
      if (prev === undefined) delete (process.env as any).JIO_MCP_ELICITATION_TIMEOUT_MS;
      else process.env.JIO_MCP_ELICITATION_TIMEOUT_MS = prev;
      process.exit(2);
    }
    await c.close().catch(() => {});
    await srv?.close?.();
    if (prev === undefined) delete (process.env as any).JIO_MCP_ELICITATION_TIMEOUT_MS;
    else process.env.JIO_MCP_ELICITATION_TIMEOUT_MS = prev;
    if (prevCapture === undefined) delete (process.env as any).TEST_CAPTURE_LOGS;
    else process.env.TEST_CAPTURE_LOGS = prevCapture;
  });
});
