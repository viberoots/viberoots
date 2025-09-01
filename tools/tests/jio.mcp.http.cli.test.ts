#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import http from "node:http";
import { describe, test } from "node:test";

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

describe("jio mcp — http cli (non-streaming)", () => {
  test("cli starts http server: /health and /call", async () => {
    const host = "127.0.0.1";
    const port = 34001 + Math.floor(Math.random() * 1000);
    const args = [
      "--mcp-server",
      "--transport=http",
      "--http-port",
      String(port),
      "--http-host",
      host,
    ];
    const p = spawn("jio", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...(process.env as any),
        JIO_ROOT: (process.env.WORKSPACE_ROOT as string) || process.cwd(),
      },
    });
    p.on("error", (e) => {
      console.error("failed to spawn jio", e);
      process.exit(2);
    });

    const healthy = await waitForHealth(host, port, 5000);
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
      console.error("/call did not return JSON", body);
      try {
        p.kill("SIGTERM");
      } catch {}
      process.exit(2);
    }
    if (!json || json.ok !== true) {
      console.error("unexpected /call response", json);
      try {
        p.kill("SIGTERM");
      } catch {}
      process.exit(2);
    }
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});
