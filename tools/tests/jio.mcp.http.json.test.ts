#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import http from "node:http";
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
  test("/call returns a single JSON document", async () => {
    const host = "127.0.0.1";
    const port = 33001 + Math.floor(Math.random() * 1000);
    const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
    const healthy = await waitForHealth(host, port, 4000);
    if (!healthy) {
      console.error("server did not become healthy");
      try {
        p.kill("SIGTERM");
      } catch {}
      process.exit(2);
    }
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ method: "POST", host, port, path: "/call" }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end("{}\n");
    });
    let json: any;
    try {
      json = JSON.parse(body);
    } catch {
      console.error("not json", body);
      try {
        p.kill("SIGTERM");
      } catch {}
      process.exit(2);
    }
    if (!json || json.ok !== true) {
      console.error("unexpected json", json);
      try {
        p.kill("SIGTERM");
      } catch {}
      process.exit(2);
    }
    if (srv && srv.close) await srv.close();
  });
});
