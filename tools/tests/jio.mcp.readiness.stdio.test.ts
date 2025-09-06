#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

describe("jio mcp — readiness stdio", () => {
  test("emits a single $jio.ctl.ready control", async () => {
    const p = spawn("jio", ["--mcp-server"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(process.env as any) },
    });
    p.on("error", (e) => {
      console.error("failed to spawn jio", e);
      process.exit(2);
    });
    let readyCount = 0;
    const onData = (buf: any) => {
      try {
        const s = Buffer.from(buf).toString("utf8");
        for (const line of s.split(/\n+/)) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj && obj["$jio.ctl"] === true && obj["$jio.ctl.ready"]) readyCount++;
          } catch {}
        }
      } catch {}
    };
    p.stderr?.on("data", onData);
    const start = Date.now();
    while (readyCount === 0 && Date.now() - start < 10000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(readyCount > 0, true, "no ready control seen");
    const start2 = Date.now();
    // Wait a bit longer to ensure no duplicates
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(readyCount, 1, "duplicate ready control seen");
    try {
      p.kill("SIGTERM");
    } catch {}
  });
});
