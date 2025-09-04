#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";
import { runInTemp } from "./lib/test-helpers";

async function httpGetJson(host: string, port: number, p: string) {
  const raw = await new Promise<string>((resolve, reject) => {
    const req = http.request({ method: "GET", host, port, path: p }, (res) => {
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function httpGetHeaders(host: string, port: number, p: string) {
  return await new Promise<{ status: number; headers: any }>((resolve, reject) => {
    const req = http.request({ method: "GET", host, port, path: p }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("resources http mime + index", () => {
  test("sniffs mime when omitted and lists in index", async () => {
    await runInTemp("resources-http-mime-index", async (tmp, $) => {
      const host = "127.0.0.1";
      const port = 34051 + Math.floor(Math.random() * 1000);
      const dataDir = path.join(tmp, "data");
      const specDir = path.join(tmp, "meta");
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(specDir, { recursive: true });
      const f = path.join(dataDir, "note.txt");
      await fsp.writeFile(f, "abc", "utf8");
      await fsp.writeFile(
        path.join(specDir, "b.resource.json"),
        JSON.stringify({ id: "res.b", name: "B", file: "../data/note.txt", etag: "auto" }),
        "utf8",
      );
      const srv = await startMcpServer({
        transport: "http",
        httpHost: host,
        httpPort: port,
        rootDir: tmp,
      });
      const idx = await httpGetJson(host, port, "/jio/resources");
      if (!Array.isArray(idx) || !idx.find((x: any) => x.id === "res.b")) {
        console.error("index missing res.b", idx);
        process.exit(2);
      }
      const h = await httpGetHeaders(host, port, "/jio/resources/res.b");
      if (h.status !== 200) {
        console.error("status", h.status);
        process.exit(2);
      }
      const ct = String(h.headers["content-type"] || "");
      if (!ct.startsWith("text/plain")) {
        console.error("expected text/plain content-type, got", ct);
        process.exit(2);
      }
      await srv?.close?.();
    });
  });
});
