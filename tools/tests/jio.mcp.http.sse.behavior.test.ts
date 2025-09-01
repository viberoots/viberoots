#!/usr/bin/env zx-wrapper
import http from "node:http";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";

describe("jio mcp — http sse behavior", () => {
  test("GET /mcp returns 400 both before and after init without session", async () => {
    const host = "127.0.0.1";
    const port = 36001 + Math.floor(Math.random() * 500);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    await waitForHealth(host, port, 2000);

    // GET before init: server should allow SSE channel establishment (200)
    const pre = await getSseWithHeaders(host, port);
    if (pre.status !== 400) {
      console.error("expected 400 before init, got", pre.status);
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
    // GET after init still 400 without established session channel
    const post = await getSseWithHeaders(host, port);
    if (post.status !== 400) {
      console.error("expected 400 after init without session, got", post.status);
      await srv?.close?.();
      process.exit(2);
    }
    await srv?.close?.();
  });
});

async function getSse(host: string, port: number, cookie?: string): Promise<number> {
  return await new Promise((resolve) => {
    const req = http.request(
      {
        method: "GET",
        host,
        port,
        path: "/mcp",
        headers: { accept: "text/event-stream", ...(cookie ? { cookie } : {}) },
      },
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

async function getSseWithHeaders(
  host: string,
  port: number,
): Promise<{ status: number; headers: any }> {
  return await new Promise((resolve) => {
    const req = http.request(
      { method: "GET", host, port, path: "/mcp", headers: { accept: "text/event-stream" } },
      (res) => {
        const headers = res.headers;
        res.resume();
        resolve({ status: res.statusCode || 0, headers });
        res.destroy();
      },
    );
    req.on("error", () => resolve({ status: 0, headers: {} }));
    req.end();
  });
}

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
  cookie?: string,
): Promise<{ status: number; body: string; headers: any }> {
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
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        const headers = res.headers;
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data, headers }));
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
