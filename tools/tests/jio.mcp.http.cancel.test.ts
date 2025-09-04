#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http cancel", () => {
  test("cancel a slow call", async () => {
    const host = "127.0.0.1";
    const port = 36501 + Math.floor(Math.random() * 500);
    const prevDelay = process.env.JIO_MCP_TEST_DELAY_MS;
    process.env.JIO_MCP_TEST_DELAY_MS = "2000";
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 4000);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${host}:${port}/mcp`) as any,
      {} as any,
    );
    const client = new Client({ name: "test", version: "0.0.0" });
    const seen: any[] = [];
    (transport as any).onmessage = (msg: any) => {
      seen.push(msg);
    };
    // Intercept outgoing client requests to capture the JSON-RPC id for tools/call
    let currentRequestId: number | string | undefined = undefined;
    const origSend = (transport as any).send?.bind(transport);
    (transport as any).send = async (message: any, options: any) => {
      try {
        if (message && message.method === "tools/call" && typeof message.id !== "undefined") {
          currentRequestId = message.id;
        }
      } catch {}
      return await origSend(message, options);
    };
    await client.connect(transport as any);
    const tools = await client.listTools({});
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.sleep");
    // fire request
    const req = client.callTool({
      name: ls?.name || "io.example.examples.sleep",
      arguments: {},
    } as any);
    // send cancellation via POST (mimic notification) with session/protocol headers and requestId
    let cancelId: any = 1;
    const startWait = Date.now();
    while (Date.now() - startWait < 1000) {
      if (typeof currentRequestId !== "undefined") {
        cancelId = currentRequestId;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const sessionId = (transport as any).sessionId as string | undefined;
    const protoVersion = (transport as any).protocolVersion as string | undefined;
    await postJson(
      host,
      port,
      {
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: cancelId },
      },
      {
        ...(sessionId ? { "mcp-session-id": String(sessionId) } : {}),
        ...(protoVersion ? { "mcp-protocol-version": String(protoVersion) } : {}),
      },
    );
    const result = await req.catch((e) => e);
    const isError =
      result instanceof Error ||
      (result && result.isError) ||
      result?.type === "error" ||
      !!result?.error ||
      !!result?.code;
    if (!isError) {
      console.error("expected cancellation error/result");
      await client.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    // Assert no progress after cancellation event observed
    const idxCancel = seen.findIndex((m) => m?.method === "notifications/cancelled");
    const idxAfter = seen.findIndex(
      (m, i) => i > idxCancel && m?.method === "notifications/progress",
    );
    if (idxCancel >= 0 && idxAfter >= 0) {
      console.error("saw progress after cancellation, which should not happen");
      await client.close().catch(() => {});
      await srv?.close?.();
      process.exit(2);
    }
    await client.close().catch(() => {});
    await srv?.close?.();
    if (prevDelay === undefined) delete (process.env as any).JIO_MCP_TEST_DELAY_MS;
    else process.env.JIO_MCP_TEST_DELAY_MS = prevDelay;
  });
});

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

async function postJson(
  host: string,
  port: number,
  body: any,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        host,
        port,
        path: "/mcp",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(extraHeaders || {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
