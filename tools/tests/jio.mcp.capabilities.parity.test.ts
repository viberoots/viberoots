#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import http from "node:http";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

async function getJson(host: string, port: number, path: string): Promise<any> {
  const body = await new Promise<string>((resolve, reject) => {
    const req = http.request({ method: "GET", host, port, path }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.end();
  });
  return JSON.parse(body || "null");
}

describe("jio mcp — capabilities parity", () => {
  test("HTTP /capabilities equals stdio ready caps (serialized)", async () => {
    const host = "127.0.0.1";
    const port = 35001 + Math.floor(Math.random() * 1000);
    const httpArgs = [
      "--mcp-server",
      "--transport=http",
      "--http-port",
      String(port),
      "--http-host",
      host,
    ];
    const httpProc = spawn("jio", httpArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(process.env as any) },
    });
    httpProc.on("error", (e) => {
      console.error("failed to spawn http jio", e);
      process.exit(2);
    });
    let ready = false;
    httpProc.stderr?.on("data", (b) => {
      const s = Buffer.from(b).toString("utf8");
      if (s.includes("jio-mcp: listening on http://")) ready = true;
    });
    const start = Date.now();
    while (!ready && Date.now() - start < 10000) {
      await new Promise((r) => setTimeout(r, 50));
      if (ready) break;
    }
    const capsHttp = await getJson(host, port, "/capabilities");
    try {
      httpProc.kill("SIGTERM");
    } catch {}

    const stdioArgs = ["--mcp-server"];
    const p = spawn("jio", stdioArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(process.env as any) },
    });
    p.on("error", (e) => {
      console.error("failed to spawn stdio jio", e);
      process.exit(2);
    });
    let capsFromStderr: any | null = null;
    const onData = (buf: any) => {
      try {
        const s = Buffer.from(buf).toString("utf8");
        for (const line of s.split(/\n+/)) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj && obj.type === "MCP_READY_CAPS" && obj.transport === "stdio") {
              capsFromStderr = obj.caps;
            }
          } catch {}
        }
      } catch {}
    };
    p.stderr?.on("data", onData);
    const start2 = Date.now();
    while (!capsFromStderr && Date.now() - start2 < 10000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(capsFromStderr, "did not receive stdio caps");
    assert.deepEqual(capsHttp.transport, "http");
    assert.deepEqual(capsFromStderr.transport, "stdio");
    // Compare tool lists ignoring transport field by mapping fqName, format and aggregate
    const simplify = (c: any) => ({
      tools: (c.tools || []).map((t: any) => ({
        fqName: t.fqName,
        format: t.output?.format,
        aggregate: t.output?.aggregate,
      })),
    });
    assert.deepEqual(simplify(capsHttp), simplify(capsFromStderr));
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});
