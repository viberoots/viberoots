#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { httpGet, pickFreePort } from "./lib/webapp-static-hmr";

test("webapp-static hmr helper times out a stalled response instead of hanging forever", async () => {
  const port = await pickFreePort();
  const server = http.createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  try {
    const startedAt = Date.now();
    await assert.rejects(
      async () => await httpGet(`http://127.0.0.1:${port}/`, 200),
      /timed out after 200ms/,
    );
    assert.ok(Date.now() - startedAt < 5000, "stalled response should fail promptly");
  } finally {
    server.close();
    await Promise.race([once(server, "close"), sleep(1000)]);
  }
});
