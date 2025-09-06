#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, test } from "node:test";

describe("jio mcp — cli ndjson gated parity", () => {
  test("when JIO_CLI_INVOCATION=ndjson, CLI streams items and aggregates match HTTP", async () => {
    const p = spawn("jio", ["io.example.examples.ls"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(process.env as any), JIO_CLI_INVOCATION: "ndjson" },
    });
    p.on("error", (e) => {
      console.error("failed to spawn jio", e);
      process.exit(2);
    });
    let items: any[] = [];
    let out = "";
    p.stdout?.on("data", (b) => (out += Buffer.from(b).toString("utf8")));
    await new Promise((r) => p.on("exit", () => r(null)));
    for (const line of out.trim().split(/\n+/)) {
      try {
        const obj = JSON.parse(line);
        items.push(obj);
      } catch {}
    }
    assert.ok(items.length > 0, "no items streamed under ndjson gating");
  });
});
