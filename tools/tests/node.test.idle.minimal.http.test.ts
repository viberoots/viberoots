#!/usr/bin/env zx-wrapper
import http from "node:http";
import { test } from "node:test";

test("node:test minimal with short-lived HTTP exits quickly", async () => {
  const start = Date.now();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  const addr = server.address();
  await new Promise<void>((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: (addr as any).port, path: "/" }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", () => resolve());
    req.end();
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.once("beforeExit", (code) => {
    try {
      console.error(JSON.stringify({ type: "MIN_HTTP_BEFORE_EXIT", code, dt: Date.now() - start }));
    } catch {}
  });
  process.once("exit", (code) => {
    try {
      console.error(JSON.stringify({ type: "MIN_HTTP_EXIT", code, dt: Date.now() - start }));
    } catch {}
  });
});
