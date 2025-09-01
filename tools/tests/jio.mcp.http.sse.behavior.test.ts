#!/usr/bin/env zx-wrapper
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http sse behavior", () => {
  test("GET /mcp returns 405 before init and 200 after init", async () => {
    const host = "127.0.0.1";
    const port = 36001 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });

    // GET before init: 405
    const s1 = await getSse(host, port);
    if (s1 !== 405) {
      console.error("expected 405 before init, got", s1);
      await srv?.close?.();
      process.exit(2);
    }

    // POST initialize
    const init = await postJson(host, port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "t", version: "0" },
        capabilities: {},
        protocolVersion: "2025-06-18",
      },
    });
    if (init.status !== 200) {
      console.error("init failed", init.status, init.body);
      await srv?.close?.();
      process.exit(2);
    }

    // GET after init: 200
    const s2 = await getSse(host, port);
    if (s2 !== 200) {
      console.error("expected 200 after init, got", s2);
      await srv?.close?.();
      process.exit(2);
    }
    await srv?.close?.();
  });
});

async function getSse(host: string, port: number): Promise<number> {
  return await new Promise((resolve) => {
    const req = http.request(
      { method: "GET", host, port, path: "/mcp", headers: { accept: "text/event-stream" } },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
        res.destroy();
      },
    );
    req.on("error", () => resolve(0));
    req.end();
  });
}

async function postJson(
  host: string,
  port: number,
  body: any,
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
