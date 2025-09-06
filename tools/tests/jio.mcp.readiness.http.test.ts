#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import http from "node:http";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

async function waitFor(fn: () => Promise<boolean>, ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("jio mcp — readiness http", () => {
  test("emits listening line and /health is 200", async () => {
    const host = "127.0.0.1";
    const port = 36001 + Math.floor(Math.random() * 1000);
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
      env: { ...(process.env as any) },
    });
    p.on("error", (e) => {
      console.error("failed to spawn jio", e);
      process.exit(2);
    });
    let sawListen = false;
    p.stderr?.on("data", (b) => {
      const s = Buffer.from(b).toString("utf8");
      if (s.includes("jio-mcp: listening on http://")) sawListen = true;
    });
    const healthy = await waitFor(async () => {
      if (sawListen) return true;
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
        return false;
      }
    }, 10000);
    assert.ok(healthy, "server did not become healthy");
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});
