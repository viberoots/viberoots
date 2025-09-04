#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";
import { runInTemp } from "./lib/test-helpers";

async function httpGetRaw(host: string, port: number, p: string, headers?: Record<string, string>) {
  return await new Promise<{ status: number; headers: any; body: Buffer }>((resolve, reject) => {
    const req = http.request({ method: "GET", host, port, path: p, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on("end", () =>
        resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function httpHead(host: string, port: number, p: string) {
  return await new Promise<{ status: number; headers: any }>((resolve, reject) => {
    const req = http.request({ method: "HEAD", host, port, path: p }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("resources http GET/HEAD", () => {
  test("serves bytes with headers and handles conditional GET", async () => {
    await runInTemp("resources-http-get", async (tmp, $) => {
      const host = "127.0.0.1";
      const port = 34001 + Math.floor(Math.random() * 1000);
      const dataDir = path.join(tmp, "docs");
      const specDir = path.join(tmp, "meta");
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.mkdir(specDir, { recursive: true });
      const f = path.join(dataDir, "file.md");
      await fsp.writeFile(f, "hello world", "utf8");
      const specPath = path.join(specDir, "a.resource.json");
      await fsp.writeFile(
        specPath,
        JSON.stringify(
          {
            id: "res.a",
            name: "A",
            file: "../docs/file.md",
            mimeType: "text/markdown",
            etag: "auto",
            cacheControl: "no-cache",
          },
          null,
          2,
        ),
        "utf8",
      );
      const srv = await startMcpServer({
        transport: "http",
        httpHost: host,
        httpPort: port,
        rootDir: tmp,
      });
      const idx = await httpGetRaw(host, port, "/jio/resources");
      if (idx.status !== 200) {
        console.error("index status", idx.status);
        process.exit(2);
      }
      const r1 = await httpGetRaw(host, port, "/jio/resources/res.a");
      if (r1.status !== 200) {
        console.error("get status", r1.status);
        process.exit(2);
      }
      const etag = r1.headers["etag"]; // may exist when auto
      const head = await httpHead(host, port, "/jio/resources/res.a");
      if (head.status !== 200) {
        console.error("head status", head.status);
        process.exit(2);
      }
      if (etag) {
        const r2 = await httpGetRaw(host, port, "/jio/resources/res.a", {
          "if-none-match": String(etag),
        });
        if (r2.status !== 304) {
          console.error("expected 304 with If-None-Match, got", r2.status);
          process.exit(2);
        }
      }
      await srv?.close?.();
    });
  });
});
